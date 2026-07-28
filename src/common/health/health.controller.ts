import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LlmService } from '../../llm/llm.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SessionService } from '../../session/session.service.js';

/**
 * Health check endpoint.
 * GET /health — para monitoring y verificar que el servicio está vivo.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly llmService: LlmService,
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) response: Response) {
    const modelInfo = this.llmService.getModelInfo();
    const [llmConnected, databaseConnected, redisConnected] = await Promise.all([
      this.llmService.validateConnection().catch(() => false),
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.sessionService.ping(),
    ]);
    const healthy = llmConnected && databaseConnected && redisConnected;
    if (!healthy) response.status(503);

    return {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      dependencies: {
        database: databaseConnected,
        redis: redisConnected,
      },
      llm: {
        ...modelInfo,
        connected: llmConnected,
      },
    };
  }
}
