import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatModule } from './chat/chat.module.js';
import { LlmModule } from './llm/llm.module.js';
import { HealthController } from './common/health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ChatModule,
    LlmModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
