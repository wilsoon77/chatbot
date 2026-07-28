import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Message } from '../llm/llm.interfaces.js';

/** Persists chat history in a tenant-scoped Redis namespace. */
@Injectable()
export class SessionService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionService.name);
  private readonly redis: Redis;
  private readonly defaultTtlSeconds = 30 * 60;

  constructor(private readonly config: ConfigService) {
    const redisUrl = this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });

    this.redis.on('connect', () => {
      this.logger.log('Conectado a Redis para sesiones.');
    });

    this.redis.on('error', (error: Error) => {
      this.logger.error(`Error de Redis: ${error.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async getHistory(tenantId: string, sessionId: string): Promise<Message[]> {
    const key = this.sessionKey(tenantId, sessionId);

    try {
      const data = await this.redis.get(key);
      if (!data) return [];

      const history = JSON.parse(data) as unknown;
      return Array.isArray(history) ? (history as Message[]) : [];
    } catch (error) {
      this.logger.error(`Error al leer historial de sesión: ${(error as Error).message}`);
      return [];
    }
  }

  async saveHistory(
    tenantId: string,
    sessionId: string,
    messages: Message[],
    ttlSeconds?: number,
  ): Promise<void> {
    const key = this.sessionKey(tenantId, sessionId);

    try {
      const ttl = this.normalizeTtl(ttlSeconds);
      await this.redis.set(key, JSON.stringify(messages), 'EX', ttl);
    } catch (error) {
      this.logger.error(`Error al guardar historial de sesión: ${(error as Error).message}`);
    }
  }

  async addMessage(
    tenantId: string,
    sessionId: string,
    message: Message,
    ttlSeconds?: number,
  ): Promise<void> {
    const history = await this.getHistory(tenantId, sessionId);
    history.push(message);
    await this.saveHistory(tenantId, sessionId, history, ttlSeconds);
  }

  async clearSession(tenantId: string, sessionId: string): Promise<void> {
    const key = this.sessionKey(tenantId, sessionId);

    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error(`Error al eliminar sesión: ${(error as Error).message}`);
    }
  }

  private sessionKey(tenantId: string, sessionId: string): string {
    return `session:${this.safePart(tenantId, 'tenantId')}:${this.safePart(sessionId, 'sessionId')}`;
  }

  private safePart(value: string, name: string): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
      throw new Error(`${name} inválido`);
    }
    return value;
  }

  private normalizeTtl(ttlSeconds?: number): number {
    const ttl = Number(ttlSeconds ?? this.defaultTtlSeconds);
    if (!Number.isFinite(ttl)) return this.defaultTtlSeconds;
    return Math.min(Math.max(Math.trunc(ttl), 60), 24 * 60 * 60);
  }
}
