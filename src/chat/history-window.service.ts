import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Message } from '../llm/llm.interfaces.js';
import { SummaryService } from './summary.service.js';

/**
 * Resultado de aplicar la ventana deslizante al historial.
 */
export interface WindowedHistory {
  /**
   * Mensajes finales a enviar al LLM: [system (resumen, opcional), ...recentMessages].
   * NOTA: el system prompt del tenant se añade aparte en ChatService.
   */
  messages: Message[];
  /** true si se generó y aplicó un resumen de contexto. */
  summaryApplied: boolean;
  /** Número de mensajes viejos que fueron resumidos/descartados. */
  oldMessagesCount: number;
}

/**
 * HistoryWindowService — Gestiona el historial de conversación aplicando una
 * ventana deslizante para limitar el consumo de tokens.
 *
 * Estrategia en capas:
 *  1. Ventana deslizante: conservar siempre los últimos `windowSize` mensajes.
 *  2. Resumen automático: cuando hay mensajes viejos fuera de la ventana,
 *     generar un resumen compacto con un modelo liviano (llama-3.1-8b) que
 *     preserva IDs/productos/preferencias, e inyectarlo como mensaje `system`.
 *  3. Fallback: si el resumen falla, se descartan los mensajes viejos sin
 *     perder la ventana reciente (mejor perder contexto viejo que fallar).
 *
 * Esto reduce drásticamente los tokens enviados al LLM en conversaciones largas
 * sin perder información crítica (IDs, productos, preferencias).
 */
@Injectable()
export class HistoryWindowService {
  private readonly logger = new Logger(HistoryWindowService.name);
  private readonly windowSize: number;
  private readonly minMessagesToSummarize: number;

  constructor(
    private readonly config: ConfigService,
    private readonly summaryService: SummaryService,
  ) {
    // Tamaño de la ventana deslizante (en mensajes user+assistant).
    this.windowSize = Number(this.config.get('HISTORY_WINDOW_SIZE', '6'));
    // Mínimo de mensajes viejos para justificar una llamada de resumen.
    this.minMessagesToSummarize = Number(this.config.get('HISTORY_MIN_TO_SUMMARIZE', '4'));
  }

  /**
   * Aplica la ventana deslizante al historial, generando un resumen de los
   * mensajes viejos si corresponde.
   *
   * @param history      Historial completo cargado de Redis (sin system prompt).
   * @param tenantName   Nombre de la tienda (contexto para el resumen).
   * @returns Objeto con los mensajes finales y metadatos.
   */
  async applyWindow(
    history: Message[],
    tenantName: string,
  ): Promise<WindowedHistory> {
    // Filtrar solo user + assistant con contenido (ya deberían venir limpios de
    // filterHistoryForPersistence, pero reforzamos por si acaso).
    const cleanHistory = history.filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0,
    );

    // Si el historial cabe en la ventana, no hay nada que hacer.
    if (cleanHistory.length <= this.windowSize) {
      return {
        messages: [...cleanHistory],
        summaryApplied: false,
        oldMessagesCount: 0,
      };
    }

    // Dividir: mensajes viejos (a resumir) + ventana reciente (a conservar).
    const splitIndex = cleanHistory.length - this.windowSize;
    const oldMessages = cleanHistory.slice(0, splitIndex);
    const recentMessages = cleanHistory.slice(splitIndex);

    this.logger.debug(
      `Ventana historial: ${cleanHistory.length} total → ${oldMessages.length} viejos (resumir) + ${recentMessages.length} recientes (conservar)`,
    );

    // Si hay pocos mensajes viejos, no vale la pena el costo de resumir.
    if (oldMessages.length < this.minMessagesToSummarize) {
      this.logger.debug(
        `Solo ${oldMessages.length} mensajes viejos (< ${this.minMessagesToSummarize}) — descartando sin resumen`,
      );
      return {
        messages: [...recentMessages],
        summaryApplied: false,
        oldMessagesCount: oldMessages.length,
      };
    }

    // Generar resumen de los mensajes viejos.
    const summary = await this.summaryService.summarize(oldMessages, tenantName);

    if (!summary) {
      // Fallback: descartar viejos sin resumen (mejor que fallar).
      this.logger.warn('No se pudo generar resumen — descartando mensajes viejos sin contexto');
      return {
        messages: [...recentMessages],
        summaryApplied: false,
        oldMessagesCount: oldMessages.length,
      };
    }

    // Inyectar el resumen como mensaje system al inicio de la ventana.
    const summaryMessage: Message = {
      role: 'system',
      content:
        `[CONTEXTO DE LA CONVERSACIÓN PREVIA]\n${summary}\n[FIN DEL CONTEXTO PREVIO]`,
    };

    this.logger.log(
      `Resumen de contexto aplicado (${oldMessages.length} mensajes → ${summary.length} chars)`,
    );

    return {
      messages: [summaryMessage, ...recentMessages],
      summaryApplied: true,
      oldMessagesCount: oldMessages.length,
    };
  }
}
