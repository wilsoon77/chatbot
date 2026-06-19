import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class InputGuardService {
  private readonly logger = new Logger(InputGuardService.name);

  // Single friendly rejection message requested by the user
  private readonly REJECTION_MESSAGE =
    'Lo siento, solo puedo ayudarte con temas relacionados a nuestra tienda, productos, pedidos y compras. ¿Hay algo de la tienda en lo que te pueda colaborar?';

  // Patterns to detect prompt injection attempts
  private readonly INJECTION_PATTERNS: RegExp[] = [
    /ignore\s+(?:any|previous|all)\s+instructions/i,
    /ignora\s+(?:las|mis|todas\s+las)?\s+instrucciones\s+anteriores/i,
    /system\s*:/i,
    /system\s+prompt/i,
    /you\s+are\s+now/i,
    /ahora\s+eres/i,
    /tú\s+eres\s+ahora/i,
    /\bDAN\b/i,
    /jailbreak/i,
    /act\s+as\s+a\s+developer/i,
    /mode\s+developer/i,
    /modo\s+desarrollador/i,
    /revela\s+(?:tu|tus)?\s*(?:instrucciones|prompt)/i,
    /reveal\s+(?:your)?\s*(?:instructions|prompt)/i,
    /forget\s+(?:everything|what\s+I\s+said|your\s+identity)/i,
    /olvida\s+(?:todo|lo\s+que\s+te\s+dije|tu\s+identidad)/i,
  ];

  // Patterns to detect sensitive personal information (like credit cards)
  private readonly PII_PATTERNS: RegExp[] = [
    /\b(?:\d[ -]*?){13,16}\b/, // Tarjetas de crédito (13-16 dígitos con guiones/espacios)
  ];

  // Blocked out-of-scope topics (generic questions about unrelated subjects)
  private readonly OUT_OF_SCOPE_PATTERNS: RegExp[] = [
    /\b(?:receta|cocinar|ingredientes|plato)\s+de\b/i, // Recetas
    /\b(?:fútbol|futbol|baloncesto|formula\s*1|f1|mundial\s+de\s+fútbol|campeonato)\b/i, // Deportes muy específicos
    /\b(?:política|politica|partido\s+político|gobierno|elecciones|presidente)\b/i, // Política
    /\b(?:religión|religion|dios|creencia|iglesia|secta)\b/i, // Religión
    /\b(?:escribe\s+un\s+código|escribe\s+un\s+script|crea\s+un\s+programa|cómo\s+programar|javascript|python|java|c\+\+|c#|html|css)\b/i, // Programación
    /\b(?:resuelve\s+este\s+problema|resuelve\s+esta\s+ecuación|matemáticas|álgebra|calcula)\b/i, // Tareas académicas
  ];

  /**
   * Evaluates user input. Returns safe status and sanitizes/handles issues.
   */
  validate(message: string): { safe: boolean; sanitized: string; reply?: string } {
    if (!message) {
      return { safe: true, sanitized: '' };
    }

    // 1. Limpieza básica de caracteres nulos o invisibles de control
    let sanitized = message.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '');
    sanitized = sanitized.trim();

    // 2. Validación de longitud excesiva (> 2000 caracteres)
    if (sanitized.length > 2000) {
      this.logger.warn(`Mensaje rechazado por longitud excesiva: ${sanitized.length} caracteres.`);
      return {
        safe: false,
        sanitized,
        reply: this.REJECTION_MESSAGE,
      };
    }

    // 3. Validación de Prompt Injection
    for (const pattern of this.INJECTION_PATTERNS) {
      if (pattern.test(sanitized)) {
        this.logger.warn(`Posible inyección de prompt detectada con el patrón: ${pattern}`);
        return {
          safe: false,
          sanitized,
          reply: this.REJECTION_MESSAGE,
        };
      }
    }

    // 4. Validación de PII (Información Personal Sensible)
    for (const pattern of this.PII_PATTERNS) {
      if (pattern.test(sanitized)) {
        this.logger.warn('Posible filtrado de PII (tarjeta de crédito) en la entrada.');
        return {
          safe: false,
          sanitized,
          reply: this.REJECTION_MESSAGE,
        };
      }
    }

    // 5. Validación de temas fuera de contexto
    for (const pattern of this.OUT_OF_SCOPE_PATTERNS) {
      if (pattern.test(sanitized)) {
        this.logger.warn(`Consulta fuera de contexto detectada: "${sanitized}" matching pattern ${pattern}`);
        return {
          safe: false,
          sanitized,
          reply: this.REJECTION_MESSAGE,
        };
      }
    }

    return { safe: true, sanitized };
  }
}
