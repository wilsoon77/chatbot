import { Injectable, Logger } from '@nestjs/common';
import type { Message } from '../llm/llm.interfaces.js';

/**
 * Servicio de sesiones (Sprint 1: en memoria).
 * Almacena el historial de conversaciones por session_id en un Map.
 * En Sprint 2 se migrará a Redis con TTL.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly sessions = new Map<string, Message[]>();

  /** TTL de sesiones en milisegundos (30 minutos) */
  private readonly SESSION_TTL = 30 * 60 * 1000;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Obtiene el historial de una sesión.
   * Si no existe, retorna un array vacío.
   */
  getHistory(sessionId: string): Message[] {
    return this.sessions.get(sessionId) || [];
  }

  /**
   * Guarda el historial actualizado de una sesión.
   * Reinicia el TTL.
   */
  saveHistory(sessionId: string, messages: Message[]): void {
    this.sessions.set(sessionId, messages);
    this.resetTtl(sessionId);
  }

  /**
   * Agrega un mensaje al historial de una sesión.
   */
  addMessage(sessionId: string, message: Message): void {
    const history = this.getHistory(sessionId);
    history.push(message);
    this.saveHistory(sessionId, history);
  }

  /**
   * Elimina una sesión.
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    const timer = this.timers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(sessionId);
    }
  }

  /** Reinicia el timer de TTL para una sesión */
  private resetTtl(sessionId: string): void {
    const existing = this.timers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.logger.debug(`Sesión ${sessionId} expirada por TTL`);
      this.sessions.delete(sessionId);
      this.timers.delete(sessionId);
    }, this.SESSION_TTL);

    this.timers.set(sessionId, timer);
  }
}
