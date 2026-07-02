import { Injectable, Logger } from '@nestjs/common';
import type { Message } from '../llm/llm.interfaces.js';
import { LlmService } from '../llm/llm.service.js';

/**
 * Servicio que resume un historial de conversación usando el modelo activo
 * para preservar contexto sin depender de un proveedor externo (como Groq).
 *
 * El resumen se inyecta como un mensaje `system` al inicio de la conversación,
 * permitiendo que el modelo principal conozca los datos clave (productos
 * mencionados, IDs, preferencias) sin reenviar todos los mensajes viejos.
 */
@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);

  constructor(private readonly llmService: LlmService) {}

  /**
   * Genera un resumen compacto de un conjunto de mensajes viejos.
   *
   * @param oldMessages Mensajes a resumir (user + assistant, sin system/tool).
   * @param tenantName  Nombre de la tienda (para contexto del resumen).
   * @returns Texto resumen de ~2-3 frases, o null si falla.
   */
  async summarize(oldMessages: Message[], tenantName: string): Promise<string | null> {
    if (!oldMessages || oldMessages.length === 0) return null;

    // Construir una transcripción lineal de los mensajes viejos.
    const transcript = oldMessages
      .map((m) => {
        const role = m.role === 'user' ? 'Usuario' : 'Asistente';
        const content = typeof m.content === 'string' ? m.content : '';
        return `${role}: ${content}`;
      })
      .join('\n');

    const systemPrompt = `Eres un asistente que resume conversaciones de e-commerce de forma ultra concisa.
Resume la siguiente conversación entre un usuario y el asistente de "${tenantName}" en MÁXIMO 3 frases.
Preserva OBLIGATORIAMENTE: IDs de productos mencionados, nombres de productos, precios, cantidades, emails, IDs de pedido, y preferencias explícitas del usuario.
No añadas saludos ni explicaciones. Responde solo con el resumen en español.`;

    const messagesForSummary: Message[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcript },
    ];

    try {
      this.logger.debug(
        `Generando resumen de ${oldMessages.length} mensajes con el LLM activo`,
      );
      const res = await this.llmService.chat(messagesForSummary, []);
      const summary = res.text?.trim() || null;

      if (summary) {
        this.logger.debug(`Resumen generado (${summary.length} chars): "${summary.slice(0, 80)}..."`);
      }
      return summary;
    } catch (error) {
      this.logger.warn(
        `Error al generar resumen: ${(error as Error).message}. Continuando sin resumen.`,
      );
      return null;
    }
  }
}
