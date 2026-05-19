import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  ILlmProvider,
  Message,
  ToolDefinition,
  LlmResponse,
  ToolCall,
} from '../llm.interfaces.js';

/**
 * Provider de Google Gemini.
 * Usa el SDK oficial @google/genai con function calling nativo.
 */
@Injectable()
export class GoogleProvider implements ILlmProvider {
  private readonly logger = new Logger(GoogleProvider.name);
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GOOGLE_API_KEY');
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY no está configurado en las variables de entorno');
    }

    this.client = new GoogleGenAI({ apiKey });
    this.model = this.config.get<string>('GOOGLE_MODEL') || 'gemini-2.5-flash';
    this.logger.log(`Google provider inicializado con modelo: ${this.model}`);
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LlmResponse> {
    // Separar system prompt del resto de mensajes
    const systemInstruction = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');

    const contents = this.convertMessages(
      messages.filter((m) => m.role !== 'system'),
    );

    // Convertir tools al formato de Gemini
    const functionDeclarations = tools.map((tool) =>
      this.convertToolDefinition(tool),
    );

    const config: Record<string, unknown> = {};
    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }
    if (functionDeclarations.length > 0) {
      config.tools = [{ functionDeclarations }];
    }

    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config,
      });

      // Verificar si hay function calls
      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const toolCalls: ToolCall[] = functionCalls.map((fc) => ({
          id: fc.id || this.generateCallId(),
          name: fc.name || '',
          args: (fc.args as Record<string, unknown>) || {},
        }));

        return {
          text: null,
          toolCalls,
          hasToolCalls: true,
        };
      }

      return {
        text: response.text || '',
        toolCalls: [],
        hasToolCalls: false,
      };
    } catch (error) {
      this.logger.error(`Error en Google provider: ${(error as Error).message}`);
      throw error;
    }
  }

  async validateConnection(): Promise<boolean> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: 'Responde solo con "ok"',
      });
      return !!response.text;
    } catch {
      return false;
    }
  }

  getModelInfo() {
    return {
      provider: 'google',
      model: this.model,
      supportsStreaming: true,
    };
  }

  // ─── Helpers privados ─────────────────────────────────────

  private convertMessages(messages: Message[]) {
    const contents: Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }> = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        contents.push({
          role: 'user',
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === 'assistant') {
        contents.push({
          role: 'model',
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === 'tool') {
        // Gemini espera functionResponse dentro de un part con rol 'user'
        contents.push({
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: msg.toolName || 'unknown',
                response: { result: msg.content },
                id: msg.toolCallId,
              },
            },
          ],
        });
      }
    }

    return contents;
  }

  /**
   * Convierte una ToolDefinition genérica al formato de Gemini
   */
  private convertToolDefinition(tool: ToolDefinition) {
    const properties: Record<string, Record<string, unknown>> = {};

    for (const [key, prop] of Object.entries(tool.parameters.properties)) {
      const geminiProp: Record<string, unknown> = {
        type: this.mapType(prop.type),
        description: prop.description,
      };
      if (prop.enum) {
        geminiProp.enum = prop.enum;
      }
      if (prop.items) {
        geminiProp.items = { type: this.mapType(prop.items.type) };
      }
      properties[key] = geminiProp;
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: Type.OBJECT,
        properties,
        required: tool.parameters.required || [],
      },
    };
  }

  private mapType(type: string): Type {
    const typeMap: Record<string, Type> = {
      string: Type.STRING,
      number: Type.NUMBER,
      integer: Type.INTEGER,
      boolean: Type.BOOLEAN,
      array: Type.ARRAY,
      object: Type.OBJECT,
    };
    return typeMap[type] || Type.STRING;
  }

  private generateCallId(): string {
    return Math.random().toString(36).substring(2, 10);
  }
}
