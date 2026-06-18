import { Injectable, Inject, Logger } from '@nestjs/common';
import type {
  ILlmProvider,
  Message,
  ToolDefinition,
  LlmResponse,
} from './llm.interfaces.js';
import { LLM_PROVIDER_TOKEN } from './llm.interfaces.js';

/**
 * Servicio principal de LLM.
 * Abstrae el provider activo — el resto del sistema llama a LlmService.chat()
 * sin saber si está usando Google, OpenAI, Anthropic u Ollama.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(LLM_PROVIDER_TOKEN)
    private readonly provider: ILlmProvider,
  ) {
    const info = this.provider.getModelInfo();
    this.logger.log(`LLM activo: ${info.provider} / ${info.model}`);
  }

  async chat(messages: Message[], tools: ToolDefinition[]): Promise<LlmResponse> {
    const response = await this.provider.chat(messages, tools);
    if (response.text) {
      response.text = this.stripThinking(response.text);
    }
    return response;
  }

  async chatStream(messages: Message[]): Promise<AsyncGenerator<string, void, unknown>> {
    let rawStream: AsyncGenerator<string, void, unknown>;

    if (this.provider.chatStream) {
      rawStream = await this.provider.chatStream(messages);
    } else {
      this.logger.warn(
        `El provider activo (${this.provider.getModelInfo().provider}) no soporta streaming. Simulando stream...`,
      );

      const response = await this.provider.chat(messages, []);
      const fullText = response.text || '';

      const generator = async function* () {
        // Divide el texto en tokens/palabras con sus espacios
        const tokens = fullText.match(/.[^\s]*\s*/g) || [fullText];
        for (const token of tokens) {
          yield token;
          await new Promise((resolve) => setTimeout(resolve, 30)); // Retardo para simular stream
        }
      };

      rawStream = generator();
    }

    return filterThinkingStream(rawStream);
  }

  private stripThinking(text: string): string {
    if (!text) return '';
    return text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*$/gi, '')
      .trim();
  }

  async validateConnection(): Promise<boolean> {
    return this.provider.validateConnection();
  }

  getModelInfo() {
    return this.provider.getModelInfo();
  }
}

/**
 * Función generadora para filtrar bloques de pensamiento <think>...</think> de un stream de tokens.
 */
export async function* filterThinkingStream(
  stream: AsyncGenerator<string, void, unknown>,
): AsyncGenerator<string, void, unknown> {
  let inThinking = false;
  let buffer = '';

  for await (const chunk of stream) {
    buffer += chunk;

    while (true) {
      if (inThinking) {
        const endIdx = buffer.toLowerCase().indexOf('</think>');
        if (endIdx !== -1) {
          buffer = buffer.substring(endIdx + 8);
          inThinking = false;
          continue;
        } else {
          break;
        }
      } else {
        const startIdx = buffer.toLowerCase().indexOf('<think>');
        if (startIdx !== -1) {
          const safeText = buffer.substring(0, startIdx);
          if (safeText) {
            yield safeText;
          }
          buffer = buffer.substring(startIdx + 7);
          inThinking = true;
          continue;
        } else {
          let prefixMatchLength = 0;
          const lowerBuf = buffer.toLowerCase();
          const maxCheck = Math.min(6, lowerBuf.length);
          for (let i = maxCheck; i >= 1; i--) {
            const suffix = lowerBuf.substring(lowerBuf.length - i);
            if ('<think>'.startsWith(suffix)) {
              prefixMatchLength = i;
              break;
            }
          }
          const safeLength = buffer.length - prefixMatchLength;
          if (safeLength > 0) {
            const safeText = buffer.substring(0, safeLength);
            yield safeText;
            buffer = buffer.substring(safeLength);
          }
          break;
        }
      }
    }
  }

  if (!inThinking && buffer) {
    yield buffer;
  }
}
