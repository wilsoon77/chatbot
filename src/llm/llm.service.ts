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
    return this.provider.chat(messages, tools);
  }

  async validateConnection(): Promise<boolean> {
    return this.provider.validateConnection();
  }

  getModelInfo() {
    return this.provider.getModelInfo();
  }
}
