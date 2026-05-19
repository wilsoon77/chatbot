import { Controller, Get } from '@nestjs/common';
import { LlmService } from '../../llm/llm.service.js';

/**
 * Health check endpoint.
 * GET /health — para monitoring y verificar que el servicio está vivo.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly llmService: LlmService) {}

  @Get()
  async check() {
    const modelInfo = this.llmService.getModelInfo();
    let llmConnected = false;

    try {
      llmConnected = await this.llmService.validateConnection();
    } catch {
      llmConnected = false;
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      llm: {
        ...modelInfo,
        connected: llmConnected,
      },
    };
  }
}
