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
 * Provider genérico compatible con el formato OpenAI v1.
 * Permite conectarse a OpenAI, OpenRouter, Together AI, DeepInfra o Hugging Face Serverless API.
 */
@Injectable()
export class OpenAiProvider implements ILlmProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('OPENAI_API_KEY') || '';
    this.model = this.config.get<string>('OPENAI_MODEL') || 'gpt-4o-mini';
    
    // Si se pasa una URL base personalizada (ej: Hugging Face o OpenRouter), se utiliza
    this.baseUrl = this.config.get<string>('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
    
    this.logger.log(
      `OpenAI-Compatible provider inicializado | modelo: ${this.model} | baseUrl: ${this.baseUrl}`
    );
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LlmResponse> {
    if (!this.apiKey && !this.baseUrl.includes('openrouter.ai')) {
      throw new Error('La variable OPENAI_API_KEY no está configurada.');
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
      // tool_choice='auto' explícito: el modelo decide si llamar tools o responder
      // directo. (Default de la API, pero se documenta la intención.)
      body.tool_choice = 'auto';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 segundos de timeout

    try {
      this.logger.debug(`Enviando petición a API compatible con OpenAI (${this.model}) en ${this.baseUrl}`);
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`El endpoint respondió con status ${response.status}: ${errorText}`);
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
        throw new Error('El endpoint devolvió una respuesta vacía');
      }

      const assistantMessage = choice.message;

      // Verificar si el modelo solicitó llamar a herramientas (tool calls)
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolCalls: ToolCall[] = assistantMessage.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          args: coerceNumericArgs(
            JSON.parse(tc.function.arguments) as Record<string, unknown>,
          ),
        }));

        this.logger.debug(`Solicitado tool calls: ${toolCalls.map((tc) => tc.name).join(', ')}`);

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
      this.logger.error(`Error en OpenAI-Compatible provider: ${(error as Error).message}`);
      throw error;
    }
  }

  async chatStream(messages: Message[]): Promise<AsyncGenerator<string, void, unknown>> {
    if (!this.apiKey && !this.baseUrl.includes('openrouter.ai')) {
      throw new Error('La variable OPENAI_API_KEY no está configurada.');
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
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
          'ngrok-skip-browser-warning': 'true',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`El endpoint de stream respondió con status ${response.status}: ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('ReadableStream no disponible en OpenAI');
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
      this.logger.error(`Error de stream en OpenAI-Compatible provider: ${(error as Error).message}`);
      throw error;
    }
  }

  async validateConnection(): Promise<boolean> {
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

  getModelInfo() {
    return {
      provider: 'openai-compatible',
      model: this.model,
      supportsStreaming: true,
    };
  }
}
