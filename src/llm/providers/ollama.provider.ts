import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ILlmProvider,
  Message,
  ToolDefinition,
  LlmResponse,
  ToolCall,
} from '../llm.interfaces.js';

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
    };

    if (openaiTools.length > 0) {
      body.tools = openaiTools;
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

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
          args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
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
      supportsStreaming: false,
    };
  }
}
