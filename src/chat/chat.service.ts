import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../llm/llm.service.js';
import { SessionService } from '../session/session.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ToolsRegistry } from '../tools/tools.registry.js';
import type { Message } from '../llm/llm.interfaces.js';
import { InputGuardService } from '../guardrails/input-guard.service.js';
import { OutputGuardService } from '../guardrails/output-guard.service.js';
import { IntentRouterService } from './intent-router.service.js';
import { HistoryWindowService } from './history-window.service.js';

/**
 * ChatService — Orquestador del Agentic Loop (Sincrónico y Streaming).
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
    private readonly inputGuard: InputGuardService,
    private readonly outputGuard: OutputGuardService,
    private readonly intentRouter: IntentRouterService,
    private readonly historyWindow: HistoryWindowService,
  ) {
    this.maxToolCalls = Number(this.config.get('MAX_TOOL_CALLS_PER_TURN', '5'));
  }

  /**
   * Procesa un mensaje de forma sincrónica.
   */
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

    // Capa de validación de entrada (Input Guard)
    const inputResult = this.inputGuard.validate(userMessage);
    if (!inputResult.safe) {
      const reply = inputResult.reply || 'Lo siento, no puedo procesar este mensaje.';
      const userMsg: Message = { role: 'user', content: userMessage };
      const assistantMsg: Message = { role: 'assistant', content: reply };
      const history = await this.sessionService.getHistory(sessionId);
      await this.sessionService.saveHistory(sessionId, [...history, userMsg, assistantMsg]);
      return { reply };
    }
    const cleanUserMessage = inputResult.sanitized;

    const lastFoundProductsContainer: { products?: any[] } = {};
    const pendingActionContainer: { action?: any } = {};

    // Carga asíncronamente el historial de la conversación desde Redis
    const history = await this.sessionService.getHistory(sessionId);
    const messages: Message[] = await this.buildBaseMessages(
      tenant.systemPrompt,
      history,
      cleanUserMessage,
      tenant.nombre,
    );

    // ── Router de intención: small-talk puro se responde SIN tools ───────
    const intent = this.intentRouter.classifyWithLog(cleanUserMessage);
    if (!intent.needsTools) {
      this.logger.log(
        `Small-talk detectado (intent="${intent.intent}") — respondiendo SIN tools`,
      );
      const noToolResponse = await this.llmService.chat(messages, []);
      const rawSmallTalk = noToolResponse.text || 'Hola, ¿en qué puedo ayudarte?';
      const reply = this.outputGuard.sanitize(rawSmallTalk, tenant.woocommerceUrl);

      const assistantMsg: Message = { role: 'assistant', content: reply };
      messages.push(assistantMsg);
      const historyToSave = this.filterHistoryForPersistence(messages);
      await this.sessionService.saveHistory(sessionId, historyToSave);
      return { reply };
    }

    let loopReply: string | null;
    try {
      loopReply = await this.runAgenticLoop(
        tenant,
        sessionId,
        messages,
        lastFoundProductsContainer,
        pendingActionContainer,
      );
    } catch (e) {
      // Guardar historial acumulado hasta el momento del error (excluyendo prompt de sistema)
      const historyToSave = this.filterHistoryForPersistence(messages);
      await this.sessionService.saveHistory(sessionId, historyToSave);

      if ((e as Error).message === 'LIMIT_EXCEEDED') {
        const errorReply =
          'No pude completar tu consulta porque requería demasiadas operaciones. ¿Podrías reformular tu pregunta?';
        return { reply: errorReply };
      }
      throw e;
    }

    // La respuesta ya fue generada por el agentic loop — no se necesita otra llamada al LLM
    const rawReply = loopReply || 'Lo siento, no pude generar una respuesta.';
    const reply = this.outputGuard.sanitize(rawReply, tenant.woocommerceUrl);

    const assistantMsg: Message = { role: 'assistant', content: reply };
    messages.push(assistantMsg);

    // Guardar historial completo al final
    const historyToSave = this.filterHistoryForPersistence(messages);
    await this.sessionService.saveHistory(sessionId, historyToSave);

    return {
      reply,
      products: lastFoundProductsContainer.products,
      action: pendingActionContainer.action,
    };
  }

  /**
   * Procesa un mensaje de forma asíncrona mediante streaming SSE.
   */
  async processMessageStream(
    tenantId: string,
    sessionId: string,
    userMessage: string,
    onToken: (token: string) => Promise<void> | void,
    onProducts: (products: any[]) => Promise<void> | void,
    onAction: (action: any) => Promise<void> | void,
  ): Promise<void> {
    const tenant = await this.tenantsService.getTenantConfig(tenantId);
    if (!tenant) {
      await onToken('Este asistente no está disponible actualmente.');
      return;
    }

    // Capa de validación de entrada (Input Guard)
    const inputResult = this.inputGuard.validate(userMessage);
    if (!inputResult.safe) {
      const reply = inputResult.reply || 'Lo siento, no puedo procesar este mensaje.';
      const userMsg: Message = { role: 'user', content: userMessage };
      const assistantMsg: Message = { role: 'assistant', content: reply };
      const history = await this.sessionService.getHistory(sessionId);
      await this.sessionService.saveHistory(sessionId, [...history, userMsg, assistantMsg]);
      await onToken(reply);
      return;
    }
    const cleanUserMessage = inputResult.sanitized;

    const lastFoundProductsContainer: { products?: any[] } = {};
    const pendingActionContainer: { action?: any } = {};

    const history = await this.sessionService.getHistory(sessionId);
    const messages: Message[] = await this.buildBaseMessages(
      tenant.systemPrompt,
      history,
      cleanUserMessage,
      tenant.nombre,
    );

    // ── Router de intención: small-talk puro → streaming real SIN tools ──
    const intent = this.intentRouter.classifyWithLog(cleanUserMessage);
    if (!intent.needsTools) {
      this.logger.log(
        `Small-talk detectado (intent="${intent.intent}") — streaming SIN tools`,
      );
      let fullReply = '';
      try {
        const stream = await this.llmService.chatStream(messages);
        for await (const token of stream) {
          fullReply += token;
          const cleanToken = token.replace(this.outputGuard.EMOJI_REGEX, '');
          if (cleanToken) {
            await onToken(cleanToken);
          }
        }
      } catch (err) {
        this.logger.warn(
          `chatStream falló para small-talk — fallback a chat() sin tools: ${(err as Error).message}`,
        );
        const noToolResponse = await this.llmService.chat(messages, []);
        fullReply = noToolResponse.text || 'Hola, ¿en qué puedo ayudarte?';
        const tokens = fullReply.match(/\S+\s*/g) || [fullReply];
        for (const token of tokens) {
          const cleanToken = token.replace(this.outputGuard.EMOJI_REGEX, '');
          if (cleanToken) {
            await onToken(cleanToken);
          }
        }
      }

      const sanitizedReply = this.outputGuard.sanitize(fullReply, tenant.woocommerceUrl);
      const assistantMsg: Message = { role: 'assistant', content: sanitizedReply };
      messages.push(assistantMsg);
      const historyToSave = this.filterHistoryForPersistence(messages);
      await this.sessionService.saveHistory(sessionId, historyToSave);
      return;
    }

    let loopReply: string | null;
    try {
      loopReply = await this.runAgenticLoop(
        tenant,
        sessionId,
        messages,
        lastFoundProductsContainer,
        pendingActionContainer,
      );
    } catch (e) {
      // Guardar historial acumulado hasta el momento del error (excluyendo prompt de sistema)
      const historyToSave = this.filterHistoryForPersistence(messages);
      await this.sessionService.saveHistory(sessionId, historyToSave);

      if ((e as Error).message === 'LIMIT_EXCEEDED') {
        await onToken(
          'No pude completar tu consulta porque requería demasiadas operaciones. ¿Podrías reformular tu pregunta?',
        );
        return;
      }
      throw e;
    }

    // Si hubo llamadas a herramientas y se encontraron productos/acciones, se envían antes del stream de texto
    if (lastFoundProductsContainer.products && lastFoundProductsContainer.products.length > 0) {
      await onProducts(lastFoundProductsContainer.products);
    }
    if (pendingActionContainer.action) {
      await onAction(pendingActionContainer.action);
    }

    // La respuesta ya fue generada por el agentic loop — emitir tokens vía SSE
    let fullReply = '';

    if (loopReply) {
      // Texto ya generado en el loop: emitir palabra por palabra para efecto de streaming
      fullReply = loopReply;
      const tokens = loopReply.match(/\S+\s*/g) || [loopReply];
      for (const token of tokens) {
        const cleanToken = token.replace(this.outputGuard.EMOJI_REGEX, '');
        if (cleanToken) {
          await onToken(cleanToken);
        }
      }
    } else {
      // Fallback: si el loop no retornó texto, hacer streaming normal
      this.logger.warn('El agentic loop no retornó texto — usando chatStream como fallback');
      const stream = await this.llmService.chatStream(messages);
      for await (const token of stream) {
        fullReply += token;
        const cleanToken = token.replace(this.outputGuard.EMOJI_REGEX, '');
        if (cleanToken) {
          await onToken(cleanToken);
        }
      }
    }

    // Sanitizar la respuesta completa acumulada antes de guardarla en la sesión de Redis
    const sanitizedReply = this.outputGuard.sanitize(fullReply, tenant.woocommerceUrl);
    const assistantMsg: Message = { role: 'assistant', content: sanitizedReply };
    messages.push(assistantMsg);

    // Guardar historial completo al final
    const historyToSave = this.filterHistoryForPersistence(messages);
    await this.sessionService.saveHistory(sessionId, historyToSave);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers compartidos
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Filtra el array de mensajes antes de persistirlo en Redis.
   *
   * Se excluyen:
   *  - Mensajes `system` (el prompt se reinyecta en cada turno desde la BD).
   *  - Mensajes `tool` (contienen JSON crudo de resultados; muy ruidosos y
   *    confunden al modelo en turnos largos).
   *  - Mensajes `assistant` que solo contienen `toolCalls` sin contenido de
   *    texto final (el mensaje sintético "[Llamando herramientas: ...]").
   *
   * Se conservan:
   *  - Mensajes `user`.
   *  - Mensajes `assistant` con `content` de texto real (la respuesta final).
   */
  private filterHistoryForPersistence(messages: Message[]): Message[] {
    return messages.filter((msg) => {
      if (msg.role === 'system') return false;
      if (msg.role === 'tool') return false;
      // Assistant: conservar solo si tiene contenido de texto real (no solo toolCalls)
      if (msg.role === 'assistant') {
        const hasTextContent =
          typeof msg.content === 'string' && msg.content.trim().length > 0;
        // Excluir el mensaje sintético de "Llamando herramientas"
        const isSyntheticToolCall =
          msg.toolCalls &&
          msg.toolCalls.length > 0 &&
          (!hasTextContent ||
            msg.content!.startsWith('[Llamando herramientas'));
        return hasTextContent && !isSyntheticToolCall;
      }
      return true;
    });
  }

  /**
   * Construye el array base de mensajes (system + historial + mensaje actual).
   * Reutilizado por los paths con y sin tools.
   *
   * Aplica la ventana deslizante al historial para limitar el consumo de
   * tokens: si el historial excede HISTORY_WINDOW_SIZE, los mensajes viejos se
   * resumen (con un modelo liviano) y se inyectan como contexto, conservando
   * solo los mensajes recientes + el resumen.
   */
  private async buildBaseMessages(
    systemPrompt: string,
    history: Message[],
    userMessage: string,
    tenantName: string,
  ): Promise<Message[]> {
    const windowed = await this.historyWindow.applyWindow(history, tenantName);
    const messages: Message[] = [];
    messages.push({ role: 'system', content: systemPrompt });
    // Los mensajes de la ventana (que pueden incluir un system de contexto previo).
    for (const msg of windowed.messages) {
      messages.push(msg);
    }
    messages.push({ role: 'user', content: userMessage });
    return messages;
  }

  /**
   * Ejecuta el bucle de razonamiento y llamadas a herramientas (Agentic Loop).
   * Retorna el texto de la respuesta final generada por el LLM.
   * El texto ya está listo para sanitización y envío al usuario.
   */
  private async runAgenticLoop(
    tenant: any,
    sessionId: string,
    messages: Message[],
    lastFoundProductsContainer: { products?: any[] },
    pendingActionContainer: { action?: any },
  ): Promise<string | null> {
    const toolDefinitions = this.toolsRegistry.getToolDefinitions(tenant.enabledTools);
    let toolCallCount = 0;

    while (true) {
      this.logger.debug(
        `Agentic loop — turn ${toolCallCount + 1}, mensajes: ${messages.length}, tools disponibles: ${toolDefinitions.length}`,
      );

      const llmResponse = await this.llmService.chat(messages, toolDefinitions);

      if (!llmResponse.hasToolCalls) {
        // Retornar el texto generado por el LLM en lugar de descartarlo
        this.logger.debug('Agentic loop finalizado — respuesta de texto obtenida');
        return llmResponse.text || null;
      }

      // Control de seguridad contra bucles infinitos de llamadas a herramientas
      toolCallCount += llmResponse.toolCalls.length;
      if (toolCallCount > this.maxToolCalls) {
        this.logger.warn(
          `Límite de tool calls excedido (${toolCallCount}/${this.maxToolCalls}) para sesión ${sessionId}`,
        );
        const errorReply =
          'No pude completar tu consulta porque requería demasiadas operaciones. ¿Podrías reformular tu pregunta?';

        const errAssistantMsg: Message = {
          role: 'assistant',
          content: errorReply,
        };
        messages.push(errAssistantMsg);
        throw new Error('LIMIT_EXCEEDED');
      }

      // Registra la llamada a la herramienta en el historial del asistente.
      // NOTA: content=null (en lugar de "[Llamando herramientas: ...]") porque
      // tener texto + tool_calls en el mismo mensaje es inusual y puede confundir
      // al modelo. OpenAI recomienda content=null cuando hay tool_calls.
      const assistantToolMsg: Message = {
        role: 'assistant',
        content: null,
        toolCalls: llmResponse.toolCalls,
      };
      messages.push(assistantToolMsg);

      // Ejecución secuencial de las herramientas solicitadas por el LLM
      for (const toolCall of llmResponse.toolCalls) {
        this.logger.log(`Tool call: ${toolCall.name}(${JSON.stringify(toolCall.args)})`);

        if (toolCall.name !== 'pedir_aclaracion' && !tenant.enabledTools.includes(toolCall.name)) {
          this.logger.warn(
            `Tool "${toolCall.name}" no habilitada para tenant "${tenant.id}"`,
          );
          const toolErrorMsg: Message = {
            role: 'tool',
            content: `Error: La herramienta "${toolCall.name}" no está disponible para este asistente.`,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
          };
          messages.push(toolErrorMsg);
          continue;
        }

        // Ejecuta la herramienta inyectando dinámicamente el tenant_id actual
        const result = await this.toolsRegistry.executeTool(
          toolCall.name,
          {
            ...toolCall.args,
            tenant_id: tenant.id,
          },
        );

        // Intercepta la solicitud de aclaración para cortocircuitar el bucle
        if (toolCall.name === 'pedir_aclaracion') {
          try {
            const parsed = JSON.parse(result);
            if (parsed.status === 'pending_clarification') {
              this.logger.debug(
                `Cortocircuitando agentic loop por aclaración: "${parsed.pregunta}"`,
              );
              
              const toolResultMsg: Message = {
                role: 'tool',
                content: result,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
              };
              messages.push(toolResultMsg);
              
              return parsed.pregunta;
            }
          } catch (e) {
            // Ignora fallos de parseo
          }
        }

        // Intercepta e indexa metadatos de productos para el widget
        if (toolCall.name === 'buscar_productos') {
          try {
            const parsed = JSON.parse(result);
            if (Array.isArray(parsed)) {
              lastFoundProductsContainer.products = parsed;
            }
          } catch (e) {
            // Ignora fallos de parseo
          }
        }

        // Intercepta y mapea la acción de agregar al carrito
        if (toolCall.name === 'agregar_al_carrito') {
          try {
            const parsed = JSON.parse(result);
            if (parsed.status === 'pending_client_action') {
              pendingActionContainer.action = {
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
      }
    }
  }
}