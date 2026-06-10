import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../llm/llm.service.js';
import { SessionService } from '../session/session.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ToolsRegistry } from '../tools/tools.registry.js';
import type { Message } from '../llm/llm.interfaces.js';

/**
 * ChatService — Orquestador del Agentic Loop.
 *
 * Flujo:
 * 1. Recibir mensaje del usuario.
 * 2. Cargar la configuración del tenant desde la base de datos de forma asíncrona.
 * 3. Cargar el historial de sesión.
 * 4. Enviar al LLM con las herramientas habilitadas.
 * 5. Si el LLM pide tool_calls → ejecutar tools pasando el tenant_id → re-enviar al LLM.
 * 6. Interceptar resultados específicos (ej: buscar_productos o agregar_al_carrito) para estructurarlos.
 * 7. Retornar respuesta final al usuario junto con los metadatos de productos o acciones del cliente.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly maxToolCalls: number;

  constructor(
    private readonly llmService: LlmService,
    private readonly sessionService: SessionService,
    private readonly tenantsService: TenantsService,
    private readonly toolsRegistry: ToolsRegistry,
    private readonly config: ConfigService,
  ) {
    this.maxToolCalls = Number(this.config.get('MAX_TOOL_CALLS_PER_TURN', '5'));
  }

  async processMessage(
    tenantId: string,
    sessionId: string,
    userMessage: string,
  ): Promise<{
    reply: string;
    products?: any[];
    action?: { type: string; payload: Record<string, any> };
  }> {
    // Carga la configuración del tenant de forma asíncrona desde la base de datos
    const tenant = await this.tenantsService.getTenantConfig(tenantId);
    if (!tenant) {
      return { reply: 'Este asistente no está disponible actualmente.' };
    }

    let lastFoundProducts: any[] | undefined = undefined;
    let pendingAction: { type: string; payload: Record<string, any> } | undefined = undefined;

    // Carga asíncronamente el historial de la conversación desde Redis
    const history = await this.sessionService.getHistory(sessionId);
    const messages: Message[] = [];

    // Prompt de sistema del tenant (siempre se posiciona al inicio)
    messages.push({
      role: 'system',
      content: tenant.systemPrompt,
    });

    // Carga el historial excluyendo prompts de sistema previos para evitar duplicación
    for (const msg of history) {
      if (msg.role !== 'system') {
        messages.push(msg);
      }
    }

    const userMsg: Message = { role: 'user', content: userMessage };
    messages.push(userMsg);
    
    // Guarda el mensaje del usuario de forma asíncrona en la base de datos de Redis
    await this.sessionService.addMessage(sessionId, userMsg);

    const toolDefinitions = this.toolsRegistry.getToolDefinitions(tenant.enabledTools);
    let toolCallCount = 0;

    // Bucle de ejecución del agente (Agentic Loop)
    while (true) {
      this.logger.debug(
        `Agentic loop — turn ${toolCallCount + 1}, mensajes: ${messages.length}`,
      );

      const llmResponse = await this.llmService.chat(messages, toolDefinitions);

      if (!llmResponse.hasToolCalls) {
        const reply = llmResponse.text || 'Lo siento, no pude generar una respuesta.';
        const assistantMsg: Message = { role: 'assistant', content: reply };
        
        // Guarda la respuesta final del asistente asíncronamente en Redis
        await this.sessionService.addMessage(sessionId, assistantMsg);

        return {
          reply,
          products: lastFoundProducts,
          action: pendingAction,
        };
      }

      // Control de seguridad contra bucles infinitos de llamadas a herramientas
      toolCallCount += llmResponse.toolCalls.length;
      if (toolCallCount > this.maxToolCalls) {
        this.logger.warn(
          `Límite de tool calls excedido (${toolCallCount}/${this.maxToolCalls}) para sesión ${sessionId}`,
        );
        const errorReply =
          'No pude completar tu consulta porque requería demasiadas operaciones. ¿Podrías reformular tu pregunta?';

        await this.sessionService.addMessage(sessionId, {
          role: 'assistant',
          content: errorReply,
        });

        return {
          reply: errorReply,
        };
      }

      // Registra la llamada a la herramienta en el historial del asistente (requerido por APIs compatibles con OpenAI)
      const assistantToolMsg: Message = {
        role: 'assistant',
        content: `[Llamando herramientas: ${llmResponse.toolCalls.map((tc) => tc.name).join(', ')}]`,
        toolCalls: llmResponse.toolCalls,
      };
      messages.push(assistantToolMsg);
      await this.sessionService.addMessage(sessionId, assistantToolMsg);

      // Ejecución secuencial de las herramientas solicitadas por el LLM
      for (const toolCall of llmResponse.toolCalls) {
        this.logger.log(`Tool call: ${toolCall.name}(${JSON.stringify(toolCall.args)})`);

        if (!tenant.enabledTools.includes(toolCall.name)) {
          this.logger.warn(
            `Tool "${toolCall.name}" no habilitada para tenant "${tenantId}"`,
          );
          const toolErrorMsg: Message = {
            role: 'tool',
            content: `Error: La herramienta "${toolCall.name}" no está disponible para este asistente.`,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
          };
          messages.push(toolErrorMsg);
          await this.sessionService.addMessage(sessionId, toolErrorMsg);
          continue;
        }

        // Ejecuta la herramienta inyectando dinámicamente el tenant_id actual del request
        const result = await this.toolsRegistry.executeTool(
          toolCall.name,
          {
            ...toolCall.args,
            tenant_id: tenantId, // El tenant real proviene de la solicitud, nunca del LLM
          },
        );

        // Intercepta e indexa metadatos de productos para enviarlos estructurados al widget
        if (toolCall.name === 'buscar_productos') {
          try {
            const parsed = JSON.parse(result);
            if (Array.isArray(parsed)) {
              lastFoundProducts = parsed;
            }
          } catch (e) {
            // Ignora fallos de parseo
          }
        }

        // Intercepta y mapea la acción de agregar al carrito para el frontend
        if (toolCall.name === 'agregar_al_carrito') {
          try {
            const parsed = JSON.parse(result);
            if (parsed.status === 'pending_client_action') {
              pendingAction = {
                type: 'add_to_cart',
                payload: {
                  productId: parsed.producto_id,
                  quantity: parsed.cantidad,
                },
              };
            }
          } catch (e) {
            // Ignora fallos de parseo
          }
        }

        const toolResultMsg: Message = {
          role: 'tool',
          content: result,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        };
        messages.push(toolResultMsg);
        await this.sessionService.addMessage(sessionId, toolResultMsg);
      }
    }
  }
}