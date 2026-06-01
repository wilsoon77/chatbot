import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../llm/llm.service';
import { SessionService } from '../session/session.service';
import { TenantsService } from '../tenants/tenants.service';
import { ToolsRegistry } from '../tools/tools.registry';
import type { Message } from '../llm/llm.interfaces';

/**
 * ChatService — Orquestador del Agentic Loop
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
    this.maxToolCalls = Number(
      this.config.get('MAX_TOOL_CALLS_PER_TURN', '5'),
    );
  }

  async processMessage(
    tenantId: string,
    sessionId: string,
    userMessage: string,
  ): Promise<string> {

    // 1. Cargar tenant (🔥 FIX: await)
    const tenant = await this.tenantsService.getTenantConfig(tenantId);

    if (!tenant) {
      return 'Este asistente no está disponible actualmente.';
    }

    // 2. Historial
    const history = this.sessionService.getHistory(sessionId);

    // 3. Construcción de mensajes
    const messages: Message[] = [];

    messages.push({
      role: 'system',
      content: tenant.systemPrompt,
    });

    for (const msg of history) {
      if (msg.role !== 'system') {
        messages.push(msg);
      }
    }

    const userMsg: Message = {
      role: 'user',
      content: userMessage,
    };

    messages.push(userMsg);

    this.sessionService.addMessage(sessionId, userMsg);

    // 4. Tools del tenant
    const toolDefinitions = this.toolsRegistry.getToolDefinitions(
      tenant.enabledTools,
    );

    // 5. Agentic loop
    let toolCallCount = 0;

    while (true) {
      this.logger.debug(`Agentic loop — mensajes: ${messages.length}`);

      const llmResponse = await this.llmService.chat(
        messages,
        toolDefinitions,
      );

      // 6. Respuesta final
      if (!llmResponse.hasToolCalls) {
        const reply =
          llmResponse.text || 'No pude generar una respuesta.';

        const assistantMsg: Message = {
          role: 'assistant',
          content: reply,
        };

        this.sessionService.addMessage(sessionId, assistantMsg);

        return reply;
      }

      // 7. límite tools
      toolCallCount += llmResponse.toolCalls.length;

      if (toolCallCount > this.maxToolCalls) {
        const errorReply =
          'La consulta requirió demasiadas operaciones. Intenta reformularla.';

        this.sessionService.addMessage(sessionId, {
          role: 'assistant',
          content: errorReply,
        });

        return errorReply;
      }

      // 8. tool calls del assistant
      const assistantToolMsg: Message = {
        role: 'assistant',
        content: `[Tools: ${llmResponse.toolCalls
          .map((t) => t.name)
          .join(', ')}]`,
        toolCalls: llmResponse.toolCalls,
      };

      messages.push(assistantToolMsg);
      this.sessionService.addMessage(sessionId, assistantToolMsg);

      // 9. ejecutar tools
      for (const toolCall of llmResponse.toolCalls) {

        if (!tenant.enabledTools.includes(toolCall.name)) {
          const toolError: Message = {
            role: 'tool',
            content: `Tool "${toolCall.name}" no habilitada.`,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
          };

          messages.push(toolError);
          this.sessionService.addMessage(sessionId, toolError);
          continue;
        }

        const result = await this.toolsRegistry.executeTool(
          toolCall.name,
            {
    ...toolCall.args,

    // NUEVO
    // El tenant real viene del request.
    // Nunca del LLM.
    tenant_id: tenantId,
  },
        );

        const toolMsg: Message = {
          role: 'tool',
          content: result,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        };

        messages.push(toolMsg);
        this.sessionService.addMessage(sessionId, toolMsg);
      }
    }
  }
}