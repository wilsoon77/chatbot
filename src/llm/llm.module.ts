import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service.js';
import { GoogleProvider } from './providers/google.provider.js';
import { OllamaProvider } from './providers/ollama.provider.js';
import { LLM_PROVIDER_TOKEN } from './llm.interfaces.js';

/**
 * Módulo LLM con Factory Provider.
 * Instancia dinámicamente el provider correcto según LLM_PROVIDER y LLM_API_PROVIDER.
 */
@Module({
  providers: [
    {
      provide: LLM_PROVIDER_TOKEN,
      useFactory: (config: ConfigService) => {
        const mode = config.get<string>('LLM_PROVIDER', 'api');

        if (mode === 'ollama') {
          return new OllamaProvider(config);
        }

        // Modo API — seleccionar sub-provider
        const apiProvider = config.get<string>('LLM_API_PROVIDER', 'google');

        switch (apiProvider) {
          case 'google':
            return new GoogleProvider(config);
          // Sprint 2+: descomentar cuando se implementen
          // case 'openai':
          //   return new OpenAiProvider(config);
          // case 'anthropic':
          //   return new AnthropicProvider(config);
          default:
            return new GoogleProvider(config);
        }
      },
      inject: [ConfigService],
    },
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
