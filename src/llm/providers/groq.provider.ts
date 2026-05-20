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
      temperature: 0.1, // Baja temperatura para comportamiento consistente de herramientas
    };

    if (openaiTools.length > 0) {
      body.tools = openaiTools;
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
          args: JSON.parse(tc.function.arguments) as Record<string, unknown>,
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

  getModelInfo() {
    return {
      provider: 'groq',
      model: this.model,
      supportsStreaming: false,
    };
  }
}
