import { Injectable, Logger } from '@nestjs/common';

/**
 * Resultado de la clasificación de intención de un mensaje de usuario.
 */
export interface IntentClassification {
  /**
   * true  → el mensaje requiere entrar al agentic loop con tools
   *         (búsqueda de productos, stock, pedidos, carrito, o aclaración).
   * false → el mensaje es small-talk puro (saludo, despedida, agradecimiento,
   *         identidad) y debe responderse SIN tools.
   */
  needsTools: boolean;
  /**
   * Etiqueta legible de la intención detectada (para logging).
   */
  intent: string;
  /**
   * true → el mensaje es una respuesta corta afirmativa/negativa ("sí", "no",
   *         "claro", "ok") que SÍ requiere tools pero depende del contexto
   *         previo. El agentic loop debe manejarlo usando el historial.
   */
  isShortAnswer: boolean;
}

/**
 * IntentRouterService — Clasificador de intención basado en regex.
 *
 * Su objetivo es evitar que los saludos, agradecimientos, despedidas y
 * preguntas de identidad entren al agentic loop con tools adjuntas, lo que
 * históricamente provocaba llamadas innecesarias a `buscar_productos` o
 * `pedir_aclaracion`.
 *
 * El clasificador es deliberadamente conservador: si hay CUALQUIER indicio de
 * una acción concreta (verbos como buscar/ver/consultar/agregar, menciones de
 * producto/pedido/stock/categoría), se devuelve `needsTools: true` para que el
 * agentic loop decida. Solo se devuelve `needsTools: false` cuando el mensaje
 * es claramente small-talk puro.
 */
@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);

  // ── Patrones de small-talk puro ────────────────────────────────────────
  // Cada patrón está anclado para coincidir con el mensaje completo (o casi).
  private readonly GREETING_RE =
    /^(?:hola\b|buenas\b|buenos\s+d[ií]as\b|buenas\s+tardes\b|buenas\s+noches\b|hey\b|qu[eé]\s+tal\b|saludos\b|holi\b|holaa*\b|hi\b|hello\b)[!.?\s]*$/i;

  private readonly FAREWELL_RE =
    /^(?:chao\b|adi[oó]s\b|hasta\s+luego\b|nos\s+vemos\b|bye\b|hasta\s+pronto\b|me\s+voy\b|cu[ií]date\b|hasta\s+la\s+pr[oó]xima\b)[!.?\s]*$/i;

  private readonly THANKS_RE =
    /^(?:gracias\b|muchas\s+gracias\b|mil\s+gracias\b|perfecto\b|genial\b|excelente\b|gracias\s+por\s+todo\b|thanks\b|thank\s+you\b|ok\s+gracias\b|listo\s+gracias\b)[!.?\s]*$/i;

  private readonly IDENTITY_RE =
    /^(?:qui[eé]n\s+eres\b|qu[eé]\s+eres\b|c[oó]mo\s+te\s+llamas\b|c[uú]al\s+es\s+tu\s+nombre\b|qu[eé]\s+puedes\s+hacer\b|qu[eé]\s+sabes\s+hacer\b|en\s+qu[eé]\s+me\s+puedes\s+ayudar\b|qu[eé]\s+haces\b|para\s+qu[eé]\s+sirves\b|c[oó]mo\s+funcionas\b|qu[eé]\s+eres\b)[!.?\s]*$/i;

  // ── Patrones de respuesta corta afirmativa/negativa ───────────────────
  // Requieren contexto previo; se marcan isShortAnswer=true y needsTools=true.
  private readonly SHORT_ANSWER_RE =
    /^(?:s[ií]\b|no\b|claro\b|claro\s+que\s+s[ií]\b|por\s+supuesto\b|ok\b|okay\b|vale\b|est[aá]\s+bien\b|d[eé]jame\s+ver\b|exacto\b|as[ií]\s+es\b|afirmativo\b|negativo\b)[!.?\s]*$/i;

  // ── Verbos/sustantivos que indican acción concreta (anti-falsos positivos) ──
  // Si el mensaje contiene alguno de estos, NO se considera small-talk puro.
  private readonly ACTION_KEYWORDS_RE =
    /\b(?:busc[aá]r?|quiero\s+ver|necesito|ver\s+stock|consultar|estado\s+de\s+mi?\s+pedido|mi?\s+pedido|agregar\s+al\s+carrito|a[nñ]adir\s+al\s+carrito|comprar|precio|cu[aá]nto\s+cuesta|cu[aá]nto\s+vale|tienen|hay\s+stock|disponible|categor[ií]a|categor[ií]as|producto|productos|teclado|mouse|monitor|laptop|aud[ií]fonos|cable|cargador|memoria|disco|tarjeta|impresora|webcam|altavoz|bocina|router|celular|tel[eé]fono|tablet|auriculares)\b/i;

  /**
   * Clasifica la intención de un mensaje.
   *
   * Reglas de decisión (en orden):
   * 1. Mensaje vacío → needsTools=false (deja que el LLM responda).
   * 2. Contiene palabras clave de acción → needsTools=true (agentic loop).
   * 3. Coincide con saludo/despedida/agradecimiento/identidad → needsTools=false.
   * 4. Coincide con respuesta corta afirmativa/negativa → needsTools=true,
   *    isShortAnswer=true (el loop + prompt reforzado manejan el contexto).
   * 5. Default → needsTools=true (conservador: deja que el loop decida).
   */
  classify(message: string): IntentClassification {
    const text = (message || '').trim();

    if (text.length === 0) {
      return { needsTools: false, intent: 'empty', isShortAnswer: false };
    }

    // (2) Anti-falso-positivo: si hay verbos/sustantivos de acción, va al loop.
    if (this.ACTION_KEYWORDS_RE.test(text)) {
      return { needsTools: true, intent: 'action', isShortAnswer: false };
    }

    // (3) Small-talk puro → sin tools.
    if (this.GREETING_RE.test(text)) {
      return { needsTools: false, intent: 'greeting', isShortAnswer: false };
    }
    if (this.FAREWELL_RE.test(text)) {
      return { needsTools: false, intent: 'farewell', isShortAnswer: false };
    }
    if (this.THANKS_RE.test(text)) {
      return { needsTools: false, intent: 'thanks', isShortAnswer: false };
    }
    if (this.IDENTITY_RE.test(text)) {
      return { needsTools: false, intent: 'identity', isShortAnswer: false };
    }

    // (4) Respuesta corta afirmativa/negativa → loop con flag de contexto.
    if (this.SHORT_ANSWER_RE.test(text)) {
      return { needsTools: true, intent: 'short_answer', isShortAnswer: true };
    }

    // (5) Default conservador: mensaje no reconocido → al loop con tools.
    return { needsTools: true, intent: 'unknown', isShortAnswer: false };
  }

  /**
   * Versión con logging de `classify`. Útil para auditar decisiones del router.
   */
  classifyWithLog(message: string): IntentClassification {
    const result = this.classify(message);
    this.logger.debug(
      `IntentRouter: intent="${result.intent}" needsTools=${result.needsTools} isShortAnswer=${result.isShortAnswer} | msg="${message?.slice(0, 60)}"`,
    );
    return result;
  }
}
