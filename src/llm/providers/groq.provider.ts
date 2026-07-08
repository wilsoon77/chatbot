import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ILlmProvider,
  Message,
  ToolDefinition,
  LlmResponse,
  ToolCall,
} from '../llm.interfaces.js';
import { coerceNumericArgs } from '../utils/coerce-args.js';
import { resolveTemperature } from '../utils/model-params.js';

/**
 * Provider para Groq.
 * Usa la API compatible con OpenAI de Groq: https://api.groq.com/openai/v1
 */
@Injectable()
export class GroqProvider implements ILlmProvider {
  private readonly logger = new Logger(GroqProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = 'https://api.groq.com/openai/v1';

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('GROQ_API_KEY') || '';
    this.model = this.config.get<string>('GROQ_MODEL') || 'llama-3.3-70b-versatile';
    this.logger.log(`Groq provider inicializado | modelo: ${this.model}`);
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LlmResponse> {
    if (!this.apiKey) {
      throw new Error('La variable GROQ_API_KEY no está configurada.');
    }

    // Convertir mensajes al formato compatible con OpenAI
    const openaiMessages = messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          content: msg.content,
          tool_call_id: msg.toolCallId || '',
          name: msg.toolName || '',
        };
      }
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        return {
          role: 'assistant' as const,
          content: null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        };
      }
      return {
        role: msg.role,
        content: msg.content,
      };
    });

    // Convertir tools al formato compatible con OpenAI
    const openaiTools = tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const body: Record<string, unknown> = {
      model: this.model,
      messages: openaiMessages,
      // Temperatura consistente entre providers (ver utils/model-params.ts).
      temperature: resolveTemperature(),
    };

    if (openaiTools.length > 0) {
      body.tools = openaiTools;
      // tool_choice='auto' explícito: el modelo decide si llamar tools o responder directo.
      // (Es el default de OpenAI/Groq, pero lo dejamos explícito para documentar la intención
      // y facilitar futuras auditorías. NO usar 'required' — forzaría tools en cada turno.)
      body.tool_choice = 'auto';
    }

    try {
      this.logger.debug(`Enviando petición a Groq (modelo: ${this.model})`);
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        // 429 = rate limit (TPD excedido en free tier). Devolvemos mensaje graceful
        // en lugar de propagar el error, para que el usuario reciba una respuesta útil.
        if (response.status === 429) {
          this.logger.warn(
            `Groq 429 (rate limit alcanzado). Devolviendo mensaje graceful. Detalle: ${errorText.slice(0, 150)}`,
          );
          return {
            text: 'El servicio está experimentando alta demanda en este momento. Por favor intenta nuevamente en unos minutos.',
            toolCalls: [],
            hasToolCalls: false,
          };
        }
        throw new Error(`Groq respondió con status ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as {
        choices: Array<{
          message: {
            content?: string | null;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };

      const choice = data.choices[0];
      if (!choice) {
        throw new Error('Groq devolvió una respuesta vacía');
      }

      const assistantMessage = choice.message;

      // Verificar si el modelo solicitó llamar a herramientas (tool calls)
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolCalls: ToolCall[] = assistantMessage.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          args: this.coerceNumericArgs(
            JSON.parse(tc.function.arguments) as Record<string, unknown>,
          ),
        }));

        this.logger.debug(`Groq solicitó tool calls: ${toolCalls.map((tc) => tc.name).join(', ')}`);

        return {
          text: null,
          toolCalls,
          hasToolCalls: true,
        };
      }

      return {
        text: assistantMessage.content || '',
        toolCalls: [],
        hasToolCalls: false,
      };
    } catch (error) {
      this.logger.error(`Error en Groq provider: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Coerce string-wrapped numbers to actual numbers in tool call arguments.
   * LLMs sometimes generate {"producto_id": "123"} instead of {"producto_id": 123}.
   * Implementación movida al helper compartido `src/llm/utils/coerce-args.ts`
   * para que todos los providers apliquen la misma normalización.
   */
  private coerceNumericArgs = coerceNumericArgs;

  async validateConnection(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async chatStream(messages: Message[]): Promise<AsyncGenerator<string, void, unknown>> {
    if (!this.apiKey) {
      throw new Error('La variable GROQ_API_KEY no está configurada.');
    }

    const openaiMessages = messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          content: msg.content,
          tool_call_id: msg.toolCallId || '',
          name: msg.toolName || '',
        };
      }
      if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
        return {
          role: 'assistant' as const,
          content: null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          })),
        };
      }
      return {
        role: msg.role === 'system' ? 'system' as const : msg.role === 'user' ? 'user' as const : 'assistant' as const,
        content: msg.content,
      };
    });

    const body = {
      model: this.model,
      messages: openaiMessages,
      temperature: resolveTemperature(),
      stream: true,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 segundos de timeout

    try {
      this.logger.debug(`Enviando petición de stream a Groq (${this.model})`);
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        // 429 = rate limit. Devolvemos un stream con un mensaje graceful.
        if (response.status === 429) {
          this.logger.warn(
            `Groq stream 429 (rate limit). Devolviendo mensaje graceful. Detalle: ${errorText.slice(0, 150)}`,
          );
          const fallbackMsg =
            'El servicio está experimentando alta demanda en este momento. Por favor intenta nuevamente en unos minutos.';
          const generator = async function* () {
            yield fallbackMsg;
          };
          return generator();
        }
        throw new Error(`Groq de stream respondió con status ${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('ReadableStream no disponible en Groq');
      }

      const decoder = new TextDecoder('utf-8');

      const generator = async function* () {
        let buffer = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              if (trimmed.startsWith('data: ')) {
                const dataStr = trimmed.substring(6).trim();
                if (dataStr === '[DONE]') {
                  return;
                }
                try {
                  const parsed = JSON.parse(dataStr) as {
                    choices: Array<{
                      delta?: {
                        content?: string;
                      };
                    }>;
                  };
                  const content = parsed.choices[0]?.delta?.content;
                  if (content) {
                    yield content;
                  }
                } catch {
                  // Omitir fallos en líneas parciales
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      };

      return generator();
    } catch (error) {
      this.logger.error(`Error de stream en Groq provider: ${(error as Error).message}`);
      throw error;
    }
  }

  getModelInfo() {
    return {
      provider: 'groq',
      model: this.model,
      supportsStreaming: true,
    };
  }
}
