import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Message } from '../llm/llm.interfaces.js';

/**
 * Servicio de sesiones de chat.
 * Almacena el historial de conversaciones de forma persistente y asíncrona en Redis con TTL de 30 minutos.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly redis: Redis;

  /** TTL de sesiones en segundos (30 minutos) */
  private readonly SESSION_TTL_SECONDS = 30 * 60;

  constructor(private readonly config: ConfigService) {
    const redisUrl = this.config.get<string>('REDIS_URL') || 'redis://localhost:6379';
    
    // Inicializar conexión con el servidor de Redis
    this.redis = new Redis(redisUrl);
    
    this.redis.on('connect', () => {
      this.logger.log('Conectado exitosamente al servidor de Redis para sesiones.');
    });

    this.redis.on('error', (error: Error) => {
      this.logger.error(`Error en la conexión con Redis: ${error.message}`, error.stack);
    });
  }

  /**
   * Obtiene el historial de una sesión.
   * Si no existe o expira, retorna un array vacío.
   */
  async getHistory(sessionId: string): Promise<Message[]> {
    try {
      const data = await this.redis.get(`session:${sessionId}`);
      if (!data) return [];
      return JSON.parse(data) as Message[];
    } catch (error) {
      this.logger.error(`Error al leer sesión ${sessionId} desde Redis: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Guarda el historial de mensajes de una sesión.
   * Aplica un TTL nativo por base de datos de 30 minutos.
   */
  async saveHistory(sessionId: string, messages: Message[]): Promise<void> {
    try {
      const key = `session:${sessionId}`;
      const value = JSON.stringify(messages);
      
      // Guarda en Redis aplicando TTL de expiración en segundos
      await this.redis.set(key, value, 'EX', this.SESSION_TTL_SECONDS);
    } catch (error) {
      this.logger.error(`Error al guardar sesión ${sessionId} en Redis: ${(error as Error).message}`);
    }
  }

  /**
   * Agrega un mensaje al historial de una sesión de forma asíncrona.
   */
  async addMessage(sessionId: string, message: Message): Promise<void> {
    const history = await this.getHistory(sessionId);
    history.push(message);
    await this.saveHistory(sessionId, history);
  }

  /**
   * Elimina una sesión de la caché de Redis.
   */
  async clearSession(sessionId: string): Promise<void> {
    try {
      await this.redis.del(`session:${sessionId}`);
    } catch (error) {
      this.logger.error(`Error al eliminar sesión ${sessionId} de Redis: ${(error as Error).message}`);
    }
  }
}
