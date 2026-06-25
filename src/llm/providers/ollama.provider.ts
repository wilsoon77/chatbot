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
 * Provider para Ollama (modelos autoalojados).
 * Usa el endpoint OpenAI-compatible de Ollama: /v1/chat/completions
 */
@Injectable()
export class OllamaProvider implements ILlmProvider {
  private readonly logger = new Logger(OllamaProvider.name);
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('OLLAMA_BASE_URL') || 'http://localhost:11434';
    this.model = this.config.get<string>('OLLAMA_MODEL') || 'llama3.2';
    this.logger.log(`Ollama provider inicializado: ${this.baseUrl} | modelo: ${this.model}`);
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LlmResponse> {
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
      stream: false, // Ollama no soporta streaming de tool calls
      // Temperatura consistente entre providers (ver utils/model-params.ts).
      temperature: resolveTemperature(),
    };

    if (openaiTools.length > 0) {
      body.tools = openaiTools;
      // tool_choice='auto' explícito: el modelo decide si llamar tools o responder
      // directo. (Default en la API OpenAI-compatible, pero se documenta la intención
      // y se iguala al comportamiento de Groq/OpenAI.)
      body.tool_choice = 'auto';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 segundos de timeout

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama respondió con status ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as {
        choices: Array<{
          message: {
            content?: string;
            tool_calls?: Array<{
              id: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };

      const choice = data.choices[0];
      if (!choice) {
        throw new Error('Ollama devolvió una respuesta vacía');
      }

      const assistantMessage = choice.message;

      // Verificar tool calls
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolCalls: ToolCall[] = assistantMessage.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          args: coerceNumericArgs(
            JSON.parse(tc.function.arguments) as Record<string, unknown>,
          ),
        }));

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
      this.logger.error(`Error en Ollama provider: ${(error as Error).message}`);
      throw error;
    }
  }

  async chatStream(messages: Message[]): Promise<AsyncGenerator<string, void, unknown>> {
    const openaiMessages = messages.map((msg) => ({
      role: msg.role === 'system' ? 'system' as const : msg.role === 'user' ? 'user' as const : 'assistant' as const,
      content: msg.content,
    }));

    const body = {
      model: this.model,
      messages: openaiMessages,
      temperature: resolveTemperature(),
      stream: true,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 segundos de timeout

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama stream respondió con status ${response.status}: ${await response.text()}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('ReadableStream no disponible en Ollama');
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
                  // Omitir fallos de parseo en líneas parciales
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
      this.logger.error(`Error de stream en Ollama provider: ${(error as Error).message}`);
      throw error;
    }
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  getModelInfo() {
    return {
      provider: 'ollama',
      model: this.model,
      supportsStreaming: true,
    };
  }
}
