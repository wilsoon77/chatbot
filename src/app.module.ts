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
import { SessionModule } from './session/session.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: (config: Record<string, unknown>) => {
        const environment = typeof config.NODE_ENV === 'string' ? config.NODE_ENV : 'development';
        const required = ['JWT_SECRET', 'ENCRYPTION_KEY'];
        if (environment === 'production') {
          required.push('CORS_ORIGINS');
        }

        const missing = required.filter((key) => {
          const value = config[key];
          return typeof value !== 'string' || value.trim().length === 0;
        });

        if (missing.length > 0) {
          throw new Error(`Faltan variables de entorno requeridas: ${missing.join(', ')}`);
        }

        if (
          environment === 'production' &&
          typeof config.JWT_SECRET === 'string' &&
          config.JWT_SECRET.length < 32
        ) {
          throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción');
        }

        if (
          environment === 'production' &&
          typeof config.CORS_ORIGINS === 'string' &&
          config.CORS_ORIGINS.split(',').some((origin) => origin.trim() === '*')
        ) {
          throw new Error('CORS_ORIGINS no puede ser * en producción');
        }

        return config;
      },
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
    SessionModule,
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
