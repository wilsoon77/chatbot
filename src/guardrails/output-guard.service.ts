import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class OutputGuardService {
  private readonly logger = new Logger(OutputGuardService.name);

  // Regex for emojis (covers standard emojis, symbols, and flags)
  public readonly EMOJI_REGEX = /[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]{2}|[\u{1F900}-\u{1F9FF}]|[\u{1F300}-\u{1F5FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F170}-\u{1F251}]|[\u{1F300}-\u{1F9FF}]|[\u{203C}]|[\u{2049}]|[\u{2139}]|[\u{2194}-\u{2199}]|[\u{21A9}-\u{21AA}]|[\u{231A}-\u{231B}]|[\u{23E9}-\u{23EC}]|[\u{23F0}]|[\u{23F3}]|[\u{24C2}]|[\u{25AA}-\u{25AB}]|[\u{25B6}]|[\u{25C0}]|[\u{25FB}-\u{25FE}]|[\u{2600}-\u{26FD}]|[\u{2702}]|[\u{2705}]|[\u{2708}-\u{270D}]|[\u{270F}]|[\u{2712}]|[\u{2714}]|[\u{2716}]|[\u{271D}]|[\u{2721}]|[\u{2728}]|[\u{2733}-\u{2734}]|[\u{273D}]|[\u{2744}]|[\u{2747}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2763}-\u{2764}]|[\u{2795}-\u{2797}]|[\u{27A1}]|[\u{27B0}]|[\u{27BF}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{2B50}]|[\u{2B55}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]/gu;

  // Patterns to detect sensitive personal information in outputs
  private readonly PII_PATTERNS: RegExp[] = [
    /\b(?:\d[ -]*?){13,16}\b/g, // Tarjetas de crédito
  ];

  /**
   * Sanitizes the LLM response text.
   */
  sanitize(text: string, woocommerceUrl?: string): string {
    if (!text) {
      return '';
    }

    let result = text;

    // 0. Eliminar bloques de pensamiento <think>...</think>
    result = result.replace(/<think>[\s\S]*?<\/think>/gi, '');
    result = result.replace(/<think>[\s\S]*$/gi, '');

    // 1. Eliminar Emojis
    result = this.removeEmojis(result);

    // 2. Sanitizar PII en la salida
    result = this.sanitizePII(result);

    // 3. Sanitizar filtraciones de datos internos (JSON, formato de tool calls crudo, etc.)
    result = this.sanitizeInternalData(result);

    // 4. Prevenir alucinaciones de URLs (sólo permitir URLs del WooCommerce del tenant)
    if (woocommerceUrl) {
      result = this.sanitizeUrls(result, woocommerceUrl);
    }

    return result.trim();
  }

  private removeEmojis(text: string): string {
    // Reemplaza todos los caracteres del rango emoji por una cadena vacía
    const cleaned = text.replace(this.EMOJI_REGEX, '');
    // Limpia espacios dobles que puedan haber quedado al eliminar emojis
    return cleaned.replace(/\s{2,}/g, ' ');
  }

  private sanitizePII(text: string): string {
    let cleaned = text;
    for (const pattern of this.PII_PATTERNS) {
      cleaned = cleaned.replace(pattern, '[DATO PROTEGIDO]');
    }
    return cleaned;
  }

  private sanitizeInternalData(text: string): string {
    let cleaned = text;

    // Detectar si el bot intenta devolver JSON crudo de tools o llamadas internas
    // Por ejemplo, bloques markdown de tipo ```json que contengan claves como 'tool', 'call', 'id', 'result'
    if (cleaned.includes('```json') && (cleaned.includes('"id"') || cleaned.includes('"name"') || cleaned.includes('"result"'))) {
      this.logger.warn('Se detectó y eliminó un bloque de datos JSON internos en la respuesta.');
      cleaned = cleaned.replace(/```json[\s\S]*?```/g, '');
    }

    // Remover frases de depuración técnica o referencias internas a "herramienta" o "tool"
    // que puedan confundir al cliente final
    cleaned = cleaned.replace(/llamaré a la herramienta/gi, 'buscaré la información');
    cleaned = cleaned.replace(/usando la tool/gi, 'en el sistema');

    return cleaned;
  }

  private sanitizeUrls(text: string, woocommerceUrl: string): string {
    // Extraer host/dominio base de la url del WooCommerce (ej: wheat-stingray-888476.hostingersite.com)
    let baseDomain = '';
    try {
      const parsed = new URL(woocommerceUrl);
      baseDomain = parsed.hostname.replace('www.', '');
    } catch {
      baseDomain = woocommerceUrl.replace(/https?:\/\/(www\.)?/, '').split('/')[0];
    }

    if (!baseDomain) return text;

    // Buscar URLs en el texto
    const urlRegex = /(https?:\/\/[^\s\)]+)/g;
    return text.replace(urlRegex, (url) => {
      try {
        const parsedUrl = new URL(url);
        const urlHost = parsedUrl.hostname.replace('www.', '');

        // Si pertenece al dominio del WooCommerce (o subdominios), es válida
        if (urlHost === baseDomain || urlHost.endsWith('.' + baseDomain)) {
          return url;
        }

        // Si es una URL hallucinated (ejemplo.com, google.com u otros), la eliminamos
        this.logger.warn(`URL alucinada detectada y removida: ${url}. Dominio base permitido: ${baseDomain}`);
        return '[enlace no disponible]';
      } catch {
        // Si no se parsea bien pero parece otra cosa, la removemos por seguridad
        return '[enlace removido]';
      }
    });
  }
}
