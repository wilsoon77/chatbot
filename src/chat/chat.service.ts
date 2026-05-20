import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../llm/llm.service.js';
import { SessionService } from '../session/session.service.js';
import { TenantService } from '../tenant/tenant.service.js';
import { ToolsRegistry } from '../tools/tools.registry.js';
import type { Message } from '../llm/llm.interfaces.js';

/**
 * ChatService — Orquestador del Agentic Loop.
 *
 * Flujo:
 * 1. Recibir mensaje del usuario
 * 2. Cargar config del tenant
 * 3. Cargar historial de sesión
 * 4. Enviar al LLM con tools habilitadas
 * 5. Si el LLM pide tool_calls → ejecutar tools → re-enviar al LLM
 * 6. Retornar respuesta final al usuario
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly maxToolCalls: number;

  constructor(
    private readonly llmService: LlmService,
    private readonly sessionService: SessionService,
    private readonly tenantService: TenantService,
    private readonly toolsRegistry: ToolsRegistry,
    private readonly config: ConfigService,
  ) {
    this.maxToolCalls = Number(this.config.get('MAX_TOOL_CALLS_PER_TURN', '5'));
  }

  async processMessage(
    tenantId: string,
    sessionId: string,
    userMessage: string,
  ): Promise<string> {
    // 1. Cargar configuración del tenant
    const tenant = this.tenantService.getTenantConfig(tenantId);
    if (!tenant) {
      return 'Este asistente no está disponible actualmente.';
    }

    // 2. Cargar historial de sesión
    const history = this.sessionService.getHistory(sessionId);

    // 3. Construir mensajes para el LLM
    const messages: Message[] = [];

    // System prompt del tenant (siempre va primero)
    messages.push({
      role: 'system',
      content: tenant.systemPrompt,
    });

    // Agregar historial existente (sin duplicar system prompts)
    for (const msg of history) {
      if (msg.role !== 'system') {
        messages.push(msg);
      }
    }

    // Agregar mensaje del usuario
    const userMsg: Message = { role: 'user', content: userMessage };
    messages.push(userMsg);

    // Persistir en sesión
    this.sessionService.addMessage(sessionId, userMsg);

    // 4. Obtener tool definitions habilitadas para este tenant
    const toolDefinitions = this.toolsRegistry.getToolDefinitions(tenant.enabledTools);

    // 5. Agentic loop
    let toolCallCount = 0;

    while (true) {
      this.logger.debug(
        `Agentic loop — turn ${toolCallCount + 1}, mensajes: ${messages.length}`,
      );

      const llmResponse = await this.llmService.chat(messages, toolDefinitions);

      // 6. Si no hay tool calls → respuesta final
      if (!llmResponse.hasToolCalls) {
        const reply = llmResponse.text || 'Lo siento, no pude generar una respuesta.';

        // Persistir respuesta del asistente en sesión
        const assistantMsg: Message = { role: 'assistant', content: reply };
        this.sessionService.addMessage(sessionId, assistantMsg);

        return reply;
      }

      // 7. Verificar límite de tool calls
      toolCallCount += llmResponse.toolCalls.length;
      if (toolCallCount > this.maxToolCalls) {
        this.logger.warn(
          `Límite de tool calls excedido (${toolCallCount}/${this.maxToolCalls}) para sesión ${sessionId}`,
        );
        const errorReply =
          'No pude completar tu consulta porque requería demasiadas operaciones. ¿Podrías reformular tu pregunta?';

        this.sessionService.addMessage(sessionId, {
          role: 'assistant',
          content: errorReply,
        });

        return errorReply;
      }

      // 8. Ejecutar cada tool call
      // Primero, agregar el "turno" del asistente con la indicación de que llamó tools
      // (necesario para mantener coherencia en el historial)
      const assistantToolMsg: Message = {
        role: 'assistant',
        content: `[Llamando herramientas: ${llmResponse.toolCalls.map((tc) => tc.name).join(', ')}]`,
        toolCalls: llmResponse.toolCalls,
      };
      messages.push(assistantToolMsg);
      this.sessionService.addMessage(sessionId, assistantToolMsg);

      for (const toolCall of llmResponse.toolCalls) {
        this.logger.log(`Tool call: ${toolCall.name}(${JSON.stringify(toolCall.args)})`);

        // Verificar que la tool está habilitada para este tenant
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
          this.sessionService.addMessage(sessionId, toolErrorMsg);
          continue;
        }

        // Ejecutar la tool
        const result = await this.toolsRegistry.executeTool(
          toolCall.name,
          toolCall.args,
        );

        // Agregar resultado al historial
        const toolResultMsg: Message = {
          role: 'tool',
          content: result,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        };
        messages.push(toolResultMsg);
        this.sessionService.addMessage(sessionId, toolResultMsg);
      }

      // Volver al inicio del loop — el LLM recibirá los resultados de las tools
    }
  }
}
