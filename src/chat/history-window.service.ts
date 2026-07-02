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
function estimateTokens(content: string | null | undefined): number {
  if (!content) return 0;
  // Estimación clásica: 1 token equivale aproximadamente a 4 caracteres en español
  return Math.ceil(content.length / 4);
}

/**
 * HistoryWindowService — Gestiona el historial de conversación aplicando una
 * ventana deslizante para limitar el consumo de tokens en base a presupuesto.
 *
 * Estrategia en capas:
 *  1. Ventana por tokens: conservar mensajes recientes que quepan en `maxHistoryTokens`.
 *  2. Resumen automático: cuando hay mensajes viejos fuera del presupuesto,
 *     generar un resumen compacto con el LLM activo para preservar metadatos clave.
 *  3. Fallback: si el resumen falla, se descartan los mensajes viejos para no saturar.
 */
@Injectable()
export class HistoryWindowService {
  private readonly logger = new Logger(HistoryWindowService.name);
  private readonly maxHistoryTokens: number;
  private readonly minMessagesToSummarize: number;

  constructor(
    private readonly config: ConfigService,
    private readonly summaryService: SummaryService,
  ) {
    // Presupuesto de tokens para el historial reciente (por defecto 1500 tokens = ~6000 caracteres)
    this.maxHistoryTokens = Number(this.config.get('HISTORY_MAX_TOKENS', '1500'));
    // Mínimo de mensajes viejos para justificar una llamada de resumen.
    this.minMessagesToSummarize = Number(this.config.get('HISTORY_MIN_TO_SUMMARIZE', '2'));
  }

  /**
   * Aplica la ventana deslizante al historial en base a tokens, generando un resumen
   * de los mensajes viejos que excedan el presupuesto.
   *
   * @param history      Historial completo cargado de Redis (sin system prompt).
   * @param tenantName   Nombre de la tienda (contexto para el resumen).
   * @returns Objeto con los mensajes finales y metadatos.
   */
  async applyWindow(
    history: Message[],
    tenantName: string,
  ): Promise<WindowedHistory> {
    // Filtrar solo user + assistant con contenido
    const cleanHistory = history.filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim().length > 0,
    );

    let accumulatedTokens = 0;
    let splitIndex = 0; // Índice de inicio de los mensajes RECIENTES

    // Recorremos de más nuevo a más viejo acumulando tokens
    for (let i = cleanHistory.length - 1; i >= 0; i--) {
      const tokens = estimateTokens(cleanHistory[i].content);
      
      // Salvaguarda: conservar siempre al menos los 2 últimos mensajes
      const isTooOld = cleanHistory.length - i > 2;
      
      if (isTooOld && accumulatedTokens + tokens > this.maxHistoryTokens) {
        splitIndex = i + 1;
        break;
      }
      accumulatedTokens += tokens;
    }

    // Si toda la conversación cabe dentro del presupuesto de tokens
    if (splitIndex === 0) {
      return {
        messages: [...cleanHistory],
        summaryApplied: false,
        oldMessagesCount: 0,
      };
    }

    // Dividir: mensajes viejos (a resumir) + ventana reciente (a conservar dentro del presupuesto).
    const oldMessages = cleanHistory.slice(0, splitIndex);
    const recentMessages = cleanHistory.slice(splitIndex);

    this.logger.debug(
      `Presupuesto historial: ${cleanHistory.length} total → ${oldMessages.length} viejos (exceden tokens) + ${recentMessages.length} recientes (en presupuesto)`,
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
