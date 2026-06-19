import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Message } from '../llm/llm.interfaces.js';

/**
 * Servicio que resume un historial de conversación usando un modelo liviano
 * (llama-3.1-8b-instant de Groq) para preservar contexto sin consumir el
 * bucket de tokens del modelo principal (llama-3.3-70b).
 *
 * El resumen se inyecta como un mensaje `system` al inicio de la conversación,
 * permitiendo que el modelo principal conozca los datos clave (productos
 * mencionados, IDs, preferencias) sin reenviar todos los mensajes viejos.
 */
@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly summaryModel: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('GROQ_API_KEY') || '';
    this.baseUrl = this.config.get<string>('GROQ_BASE_URL') || 'https://api.groq.com/openai/v1';
    // Modelo liviano para resúmenes (límites TPD mucho más altos que el 70b).
    this.summaryModel = this.config.get<string>('GROQ_SUMMARY_MODEL') || 'llama-3.1-8b-instant';
  }

  /**
   * Genera un resumen compacto de un conjunto de mensajes viejos.
   *
   * @param oldMessages Mensajes a resumir (user + assistant, sin system/tool).
   * @param tenantName  Nombre de la tienda (para contexto del resumen).
   * @returns Texto resumen de ~2-3 frases, o null si falla.
   */
  async summarize(oldMessages: Message[], tenantName: string): Promise<string | null> {
    if (!oldMessages || oldMessages.length === 0) return null;
    if (!this.apiKey) {
      this.logger.warn('GROQ_API_KEY no configurada — no se puede generar resumen.');
      return null;
    }

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

    const body = {
      model: this.summaryModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
      temperature: 0,
      max_tokens: 200,
    };

    try {
      this.logger.debug(
        `Generando resumen de ${oldMessages.length} mensajes con ${this.summaryModel}`,
      );
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.warn(
          `Resumen falló (status ${response.status}): ${errorText.slice(0, 200)}. Continuando sin resumen.`,
        );
        return null;
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content?: string | null } }>;
      };
      const summary = data.choices?.[0]?.message?.content?.trim() || null;

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
