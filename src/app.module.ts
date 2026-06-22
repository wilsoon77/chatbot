import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { ChatModule } from './chat/chat.module.js';
import { LlmModule } from './llm/llm.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

import { HealthController } from './common/health/health.controller.js';

import { AuthModule } from './auth/auth.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 10000, // 10 segundos
        limit: 5,   // máximo 5 peticiones por 10 segundos
      },
      {
        name: 'medium',
        ttl: 60000, // 60 segundos (1 minuto)
        limit: 20,  // máximo 20 peticiones por minuto
      },
    ]),
    ChatModule,
    LlmModule,
    TenantsModule,
    PrismaModule,
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
