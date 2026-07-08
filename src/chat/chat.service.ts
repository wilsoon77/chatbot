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
import type { IntentClassification } from './intent-router.service.js';
import { HistoryWindowService } from './history-window.service.js';
import { buildSystemPrompt } from './prompts/system-prompt.template.js';
import type { ToolInfo } from '../tools/tools.registry.js';
import { ConnectorRegistry } from '../commerce/connector.registry.js';
import { removeDiacritics } from '../tools/woocommerce/woocommerce.tool.js';

/**
 * Prefijo del mensaje de contexto de productos que inyecta
 * `filterHistoryForPersistence`. Se usa para detectar si en el historial hay
 * productos mostrados recientemente (punto 3 de la política: resolución de
 * referencias multi-turno).
 */
const PRODUCT_CONTEXT_PREFIX = '[Contexto interno — productos mostrados al usuario]';

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
    private readonly connectorRegistry: ConnectorRegistry,
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
      tenant.id,
      tenant.systemPrompt,
      history,
      cleanUserMessage,
      tenant.nombre,
      tenant.enabledTools,
    );

    // ── Router de intención: small-talk puro se responde SIN tools ───────
    const intent = this.intentRouter.classifyWithLog(cleanUserMessage);
    // Cambio 3: las respuestas cortas ("sí/ok/vale") sin acción pendiente se
    // responden directo, sin entrar al agentic loop.
    const hasProductContext = this.hasRecentProductContext(history);
    const skipToolsForShortAnswer =
      intent.isShortAnswer && !hasProductContext;
    if (!intent.needsTools || skipToolsForShortAnswer) {
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

    let loopResult: { text: string | null; executedTools: boolean };
    try {
      loopResult = await this.runAgenticLoop(
        tenant,
        sessionId,
        messages,
        lastFoundProductsContainer,
        pendingActionContainer,
        intent,
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

    let rawReply = '';
    if (loopResult.text !== null) {
      rawReply = loopResult.text;
    } else if (loopResult.executedTools) {
      this.logger.debug('Generando respuesta final síncrona tras ejecución de herramientas');
      const finalResponse = await this.llmService.chat(messages, []);
      rawReply = finalResponse.text || '';
    } else {
      rawReply = 'Lo siento, no pude generar una respuesta.';
    }

    const reply = this.outputGuard.sanitize(rawReply, tenant.woocommerceUrl);

    const assistantMsg: Message = { role: 'assistant', content: reply };
    messages.push(assistantMsg);

    // Guardar historial completo al final
    const historyToSave = this.filterHistoryForPersistence(messages, lastFoundProductsContainer.products);
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
      tenant.id,
      tenant.systemPrompt,
      history,
      cleanUserMessage,
      tenant.nombre,
      tenant.enabledTools,
    );

    // ── Router de intención: small-talk puro → streaming real SIN tools ──
    const intent = this.intentRouter.classifyWithLog(cleanUserMessage);
    // Cambio 3: respuestas cortas sin acción pendiente → directo sin tools.
    const hasProductContext = this.hasRecentProductContext(history);
    const skipToolsForShortAnswer =
      intent.isShortAnswer && !hasProductContext;
    if (!intent.needsTools || skipToolsForShortAnswer) {
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

    let loopResult: { text: string | null; executedTools: boolean };
    try {
      loopResult = await this.runAgenticLoop(
        tenant,
        sessionId,
        messages,
        lastFoundProductsContainer,
        pendingActionContainer,
        intent,
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

    // La respuesta ya fue generada por el agentic loop o se generará en streaming
    let fullReply = '';

    if (loopResult.text !== null) {
      // Sanitizar la respuesta completa generada por el loop antes de emitirla al cliente
      const sanitizedReply = this.outputGuard.sanitize(loopResult.text, tenant.woocommerceUrl);
      fullReply = sanitizedReply;
      
      // Emitir palabra por palabra para efecto de streaming
      const tokens = sanitizedReply.match(/\S+\s*/g) || [sanitizedReply];
      for (const token of tokens) {
        const cleanToken = token.replace(this.outputGuard.EMOJI_REGEX, '');
        if (cleanToken) {
          await onToken(cleanToken);
        }
      }
    } else if (loopResult.executedTools) {
      // Generar la respuesta final en streaming real usando chatStream
      this.logger.log('Generando respuesta final en streaming real tras herramientas...');
      const stream = await this.llmService.chatStream(messages);
      for await (const token of stream) {
        fullReply += token;
        const cleanToken = token.replace(this.outputGuard.EMOJI_REGEX, '');
        if (cleanToken) {
          await onToken(cleanToken);
        }
      }
      // Sanitizar la salida completa al final
      fullReply = this.outputGuard.sanitize(fullReply, tenant.woocommerceUrl);
    } else {
      // Fallback
      fullReply = 'Lo siento, no pude generar una respuesta.';
    }

    const assistantMsg: Message = { role: 'assistant', content: fullReply };
    messages.push(assistantMsg);

    // Guardar historial completo al final
    const historyToSave = this.filterHistoryForPersistence(messages, lastFoundProductsContainer.products);
    await this.sessionService.saveHistory(sessionId, historyToSave);
  }

  // ───────────────────────────────────────────────────────────────────────
  // Helpers compartidos
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Indica si el historial reciente contiene un mensaje de contexto de
   * productos inyectado por `filterHistoryForPersistence`. Se usa para decidir
   * si una respuesta corta ("sí", "ok") puede resolverse directamente (no hay
   * acción pendiente) o si debe entrar al agentic loop (hay productos
   * mostrados sobre los que actuar).
   *
   * Solo se considera el contexto "reciente": se miran los últimos
   * `RECENT_WINDOW` mensajes para no reaccionar a productos mostrados hace
   * muchos turnos.
   */
  private hasRecentProductContext(history: Message[]): boolean {
    const RECENT_WINDOW = 6;
    const slice = history.slice(-RECENT_WINDOW);
    return slice.some(
      (m) =>
        typeof m.content === 'string' &&
        m.content.startsWith(PRODUCT_CONTEXT_PREFIX),
    );
  }

  /**
   * Extrae un término de búsqueda a partir del último mensaje del usuario.
   * Heurística simple (sin LLM): toma el contenido del último `role: 'user'`,
   * elimina stopwords/verbos de acción comunes en español, y devuelve la
   * primera palabra significativa restante (o la cadena completa si sobra
   * poco). Se usa en el guard de existencia para forzar una búsqueda sintética.
   *
   * Devuelve null si no se pudo extraer un término útil.
   */
  private extractSearchQuery(messages: Message[]): string | null {
    // Último mensaje del usuario (ignorando el system de contexto previo).
    let userText = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
        userText = messages[i].content as string;
        break;
      }
    }
    if (!userText) return null;

    // Stopwords / verbos de acción que NO aportan a la búsqueda.
    const stopwords =
      /^(?:quiero|busc[aá]r?|busco|necesito|ver|tienen|hay|alguno|alguna|algunos|algunas|un|una|unos|unas|el|la|los|las|de|del|para|por\s+favor|me\s+pueden|me\s+puedes|dame|muestra|mostrar|comprar|precio|cu[aá]nto|cuesta|vale|cual|cu[aá]l)\b/gi;

    const cleaned = removeDiacritics(userText)
      .replace(/[^\p{L}\p{N}\s]/gu, ' ') // solo letras/números/espacios
      .replace(/\s+/g, ' ')
      .trim()
      .replace(stopwords, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return null;

    // Si queda multi-palabra, la tool ya hace fallback a la primera palabra;
    // pasamos el término limpio completo para que su post-filter por tokens
    // funcione mejor.
    return cleaned;
  }

  /**
   * Detecta si el último mensaje del usuario menciona una categoría del
   * catálogo pre-cargado en el system prompt. Busca coincidencia fuzzy del
   * texto del usuario contra los nombres de categorías conocidas.
   *
   * Devuelve el nombre de la categoría si hay coincidencia, o null si no.
   */
  private detectCategoryMention(
    messages: Message[],
    knownCategories: { nombre: string; id: string }[] | null,
  ): string | null {
    if (!knownCategories || knownCategories.length === 0) return null;

    // Último mensaje del usuario.
    let userText = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
        userText = messages[i].content as string;
        break;
      }
    }
    if (!userText) return null;

    const normalized = removeDiacritics(userText).toLowerCase();

    // Buscar coincidencia exacta o parcial de un nombre de categoría en el texto.
    for (const cat of knownCategories) {
      const catNorm = removeDiacritics(cat.nombre).toLowerCase();
      if (normalized.includes(catNorm)) {
        return cat.nombre;
      }
    }
    return null;
  }

  /**
   * Ejecuta una `buscar_productos` sintética y empuja los mensajes al array
   * (assistant tool-call + tool result) para que el LLM, en la siguiente
   * iteración del loop, vea el resultado de la búsqueda y responda en base a él.
   *
   * Es el mecanismo determinista del guard de existencia: garantiza que la
   * búsqueda ocurre sin depender de que el LLM decida llamarla.
   *
   * @param categoria  Nombre o ID de categoría (opcional). Si se pasa, la
   *                   búsqueda se hace por categoría en vez de por query de texto.
   */
  private async injectSyntheticSearch(
    tenantId: string,
    query: string,
    messages: Message[],
    lastFoundProductsContainer: { products?: any[] },
    categoria?: string,
  ): Promise<void> {
    const callId = `synth_search_${Date.now()}`;

    // Mensaje assistant simulando la llamada a la herramienta.
    const toolArgs: Record<string, unknown> = {};
    if (query) toolArgs.query = query;
    if (categoria) toolArgs.categoria = categoria;

    const assistantToolMsg: Message = {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: callId, name: 'buscar_productos', args: toolArgs }],
    };
    messages.push(assistantToolMsg);

    // Ejecución real de la herramienta.
    const result = await this.toolsRegistry.executeTool('buscar_productos', {
      ...toolArgs,
      tenant_id: tenantId,
    });

    // Indexar resultados reales para el widget (igual que la intercepción normal).
    try {
      const parsed = JSON.parse(result);
      let products: any[] | null = null;
      if (Array.isArray(parsed)) {
        products = parsed;
      } else if (parsed && parsed.status === 'partial_match' && Array.isArray(parsed.productos)) {
        products = parsed.productos;
      }

      if (products && products.length > 0) {
        lastFoundProductsContainer.products = products;
      }
    } catch {
      // Ignora fallos de parseo
    }

    const toolResultMsg: Message = {
      role: 'tool',
      content: result,
      toolCallId: callId,
      toolName: 'buscar_productos',
    };
    messages.push(toolResultMsg);
  }

  /**
   * Filtra el array de mensajes antes de persistirlo en Redis.
   *
   * Se excluyen:
   *  - Mensajes `system` (el prompt se reinyecta en cada turno desde la BD).
   *  - Mensajes `tool` (contienen JSON crudo de resultados).
   *  - Mensajes `assistant` que solo contienen `toolCalls` sin contenido de
   *    texto final.
   *
   * Se conservan:
   *  - Mensajes `user`.
   *  - Mensajes `assistant` con `content` de texto real (la respuesta final).
   *
   * Adicionalmente, si hubo resultados de buscar_productos, se inyecta un
   * mensaje de contexto compacto con los IDs y nombres de productos encontrados,
   * para que el LLM pueda referenciarlos en turnos posteriores.
   */
  private filterHistoryForPersistence(
    messages: Message[],
    lastFoundProducts?: any[],
  ): Message[] {
    const filtered = messages.filter((msg) => {
      if (msg.role === 'system') return false;
      if (msg.role === 'tool') return false;
      // Assistant: conservar solo si tiene contenido de texto real (no solo toolCalls)
      if (msg.role === 'assistant') {
        const hasTextContent =
          typeof msg.content === 'string' && msg.content.trim().length > 0;
        // Excluir mensajes que solo son toolCalls sin texto
        const isSyntheticToolCall =
          msg.toolCalls &&
          msg.toolCalls.length > 0 &&
          (!hasTextContent ||
            msg.content!.startsWith('[Llamando herramientas'));
        return hasTextContent && !isSyntheticToolCall;
      }
      return true;
    });

    // Inyectar contexto compacto de productos encontrados para referencia futura.
    // Se guarda como mensaje 'assistant' especial justo antes del último mensaje.
    if (lastFoundProducts && lastFoundProducts.length > 0) {
      const compact = lastFoundProducts.map((p: any) => ({
        id: p.id,
        nombre: p.nombre,
      }));
      const contextMsg: Message = {
        role: 'assistant',
        content: `[Contexto interno — productos mostrados al usuario]: ${JSON.stringify(compact)}`,
      };
      // Insertar antes del último mensaje (que es la respuesta del asistente)
      const lastMsg = filtered[filtered.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        filtered.splice(filtered.length - 1, 0, contextMsg);
      } else {
        filtered.push(contextMsg);
      }
    }

    return filtered;
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
    tenantId: string,
    tenantPrompt: string,
    history: Message[],
    userMessage: string,
    tenantName: string,
    enabledTools: string[],
  ): Promise<Message[]> {
    const windowed = await this.historyWindow.applyWindow(history, tenantName);
    const messages: Message[] = [];
    // El system prompt final combina la persona del tenant (BD) con el bloque
    // dinámico de política de uso de herramientas (ver prompts/system-prompt.template.ts).
    // Las instrucciones se generan desde las tools reales habilitadas del tenant.
    const toolInfo: ToolInfo[] = this.toolsRegistry.getEnabledToolInfo(enabledTools);
    // Obtener categorías de la tienda para inyectarlas como contexto pre-cargado.
    // Si falla, se devuelve null y el prompt se genera sin el bloque de catálogo.
    const categories = await this.connectorRegistry.getCategoriesForContext(tenantId);
    messages.push({
      role: 'system',
      content: buildSystemPrompt(tenantPrompt, tenantName, toolInfo, categories),
    });
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
    intent: IntentClassification,
  ): Promise<{ text: string | null; executedTools: boolean }> {
    const toolDefinitions = this.toolsRegistry.getToolDefinitions(tenant.enabledTools);
    let toolCallCount = 0;
    // Estado por turno: si ya se ejecutó buscar_productos (lo usa el guard de
    // existencia para forzar una búsqueda antes de permitir pedir_aclaracion).
    let searchAttempted = false;
    let executedTools = false;

    while (true) {
      this.logger.debug(
        `Agentic loop — turn ${toolCallCount + 1}, mensajes: ${messages.length}, tools disponibles: ${toolDefinitions.length}`,
      );

      const llmResponse = await this.llmService.chat(messages, toolDefinitions);

      if (!llmResponse.hasToolCalls) {
        // Retornar el texto generado por el LLM en lugar de descartarlo
        this.logger.debug('Agentic loop finalizado — respuesta de texto obtenida');
        return { text: llmResponse.text || null, executedTools };
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
              const toolResultMsg: Message = {
                role: 'tool',
                content: result,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
              };
              messages.push(toolResultMsg);

              // ── GUARD DE EXISTENCIA (Cambio C) ───────────────────────────
              // Si el usuario pidió buscar un producto pero el LLM intenta pedir
              // aclaración SIN haber buscado antes, forzamos una búsqueda
              // sintética determinista. Así garantizamos que siempre se verifica
              // la existencia del producto antes de preguntar detalles.
              if (intent.isProductSearch && !searchAttempted && tenant.enabledTools.includes('buscar_productos')) {
                // Detectar si el usuario mencionó una categoría conocida.
                // Si es así, la búsqueda sintética se hace por categoría en vez de query.
                const knownCategories = await this.connectorRegistry.getCategoriesForContext(tenant.id);
                const detectedCategory = this.detectCategoryMention(messages, knownCategories);

                if (detectedCategory) {
                  this.logger.warn(
                    `pedir_aclaracion bloqueado por guard de existencia — forzando búsqueda sintética ` +
                      `con categoria="${detectedCategory}". Pregunta del modelo que se descarta: "${parsed.pregunta}"`,
                  );
                  await this.injectSyntheticSearch(
                    tenant.id,
                    '', // sin query — buscar solo por categoría
                    messages,
                    lastFoundProductsContainer,
                    detectedCategory,
                  );
                  searchAttempted = true;
                  continue;
                }

                const synthQuery = this.extractSearchQuery(messages);
                if (synthQuery) {
                  this.logger.warn(
                    `pedir_aclaracion bloqueado por guard de existencia — forzando búsqueda sintética ` +
                      `con query="${synthQuery}". Pregunta del modelo que se descarta: "${parsed.pregunta}"`,
                  );
                  await this.injectSyntheticSearch(
                    tenant.id,
                    synthQuery,
                    messages,
                    lastFoundProductsContainer,
                  );
                  searchAttempted = true;
                  continue;
                }
              }

              // Protección (Cambio 2): si hay productos mostrados en el contexto
              // reciente, el modelo probablemente está pidiendo un ID que ya
              // tiene. En lugar de cortocircuitar, se deja que el loop itere.
              if (this.hasRecentProductContext(messages)) {
                this.logger.warn(
                  `pedir_aclaracion invocado con contexto de productos presente — no se cortocircuita, ` +
                    `se deja iterar al loop para resolver el ID del contexto. Pregunta del modelo: "${parsed.pregunta}"`,
                );
                continue;
              }

              this.logger.debug(
                `Cortocircuitando agentic loop por aclaración: "${parsed.pregunta}"`,
              );
              return { text: parsed.pregunta, executedTools: true };
            }
          } catch (e) {
            // Ignora fallos de parseo
          }
        }

        // Intercepta e indexa metadatos de productos para el widget
        if (toolCall.name === 'buscar_productos') {
          searchAttempted = true;
          try {
            const parsed = JSON.parse(result);
            // Solo llenar el container (carousel del widget) si hubo resultados
            // reales (array u objeto con status "partial_match" conteniendo productos).
            // El envelope { status: 'no_results' } no es un array
            // y no debe mostrarse como carousel vacío.
            let products: any[] | null = null;
            if (Array.isArray(parsed)) {
              products = parsed;
            } else if (parsed && parsed.status === 'partial_match' && Array.isArray(parsed.productos)) {
              products = parsed.productos;
            }

            if (products && products.length > 0) {
              lastFoundProductsContainer.products = products;
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

      // Salir inmediatamente tras procesar las herramientas del primer turno.
      // De esta forma el llamador podrá generar la respuesta final de forma síncrona o streaming real.
      this.logger.debug('Herramientas ejecutadas en este turno — saliendo del loop de tools');
      return { text: null, executedTools: true };
    }
  }
}