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
  /**
   * true → el mensaje pide buscar / ver / comprar un producto concreto
   *         (menciona un sustantivo de producto o un verbo de búsqueda).
   *         Lo usa el agentic loop para forzar una `buscar_productos` antes de
   *         permitir `pedir_aclaracion` (guard de existencia de productos).
   */
  isProductSearch: boolean;
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
    /^(?:hola\b|buenas\b|buenos\s+dias\b|buenas\s+tardes\b|buenas\s+noches\b|hey\b|que\s+tal\b|saludos\b|holi\b|holaa*\b|hi\b|hello\b)[!.?\s]*$/i;

  private readonly FAREWELL_RE =
    /^(?:chao\b|adios\b|hasta\s+luego\b|nos\s+vemos\b|bye\b|hasta\s+pronto\b|me\s+voy\b|cuidate\b|hasta\s+la\s+proxima\b)[!.?\s]*$/i;

  private readonly THANKS_RE =
    /^(?:gracias\b|muchas\s+gracias\b|mil\s+gracias\b|perfecto\b|genial\b|excelente\b|gracias\s+por\s+todo\b|thanks\b|thank\s+you\b|ok\s+gracias\b|listo\s+gracias\b)[!.?\s]*$/i;

  private readonly IDENTITY_RE =
    /^(?:quien\s+eres\b|que\s+eres\b|como\s+te\s+llamas\b|cual\s+es\s+tu\s+nombre\b|que\s+puedes\s+hacer\b|que\s+sabes\s+hacer\b|en\s+que\s+me\s+puedes\s+ayudar\b|que\s+haces\b|para\s+que\s+sirves\b|como\s+funcionas\b|que\s+eres\b)[!.?\s]*$/i;

  // ── Patrones de respuesta corta afirmativa/negativa ───────────────────
  // Requieren contexto previo; se marcan isShortAnswer=true y needsTools=true.
  private readonly SHORT_ANSWER_RE =
    /^(?:si\b|no\b|claro\b|claro\s+que\s+si\b|por\s+supuesto\b|ok\b|okay\b|vale\b|esta\s+bien\b|dejame\s+ver\b|exacto\b|asi\s+es\b|afirmativo\b|negativo\b)[!.?\s]*$/i;

  // ── Verbos/sustantivos de BÚSQUEDA DE PRODUCTO ─────────────────────────
  // Matchea raíces de intención de compra/búsqueda/consulta y sustantivos comunes de tecnología.
  private readonly PRODUCT_SEARCH_RE = new RegExp(
    `\\b(?:` +
    [
      'busc[a-z]*',
      'necesit[a-z]*',
      'quier[a-z]*',
      'quisier[a-z]*',
      'compr[a-z]*',
      'cotiz[a-z]*',
      'adquir[a-z]*',
      'mostr[a-z]*',
      'muestr[a-z]*',
      'ensen[a-z]*',
      'ver', 'viendo', 'precio[s]?', 'costo[s]?', 'cuesta[n]?', 'vale[n]?',
      'stock', 'disponib[a-z]*', 'exist[a-z]*', 'tienen', 'hay',
      'teclado[s]?', 'mouse[s]?', 'raton[es]?', 'monitor[es]?', 'pantalla[s]?',
      'laptop[s]?', 'computador[es]?', 'ordenador[es]?', 'audifono[s]?',
      'auricular[es]?', 'parlante[s]?', 'bocina[s]?', 'altavoz[ces]?',
      'cable[s]?', 'cargador[es]?', 'memoria[s]?', 'disco[s]?', 'tarjeta[s]?',
      'impresora[s]?', 'webcam[s]?', 'camara[s]?', 'router[s]?', 'modem[s]?',
      'celular[es]?', 'telefono[s]?', 'tablet[s]?', 'microfono[s]?',
      'producto[s]?', 'articulo[s]?', 'item[s]?'
    ].join('|') +
    `)\\b`,
    'i'
  );

  // ── Verbos/sustantivos que indican acción concreta (anti-falsos positivos) ──
  // Si el mensaje contiene alguno de estos, NO se considera small-talk puro.
  // Extiende PRODUCT_SEARCH_RE con palabras de carrito.
  private readonly ACTION_KEYWORDS_RE = new RegExp(
    `\\b(?:` +
    [
      'busc[a-z]*',
      'necesit[a-z]*',
      'quier[a-z]*',
      'quisier[a-z]*',
      'compr[a-z]*',
      'cotiz[a-z]*',
      'adquir[a-z]*',
      'mostr[a-z]*',
      'muestr[a-z]*',
      'ensen[a-z]*',
      'ver', 'viendo', 'precio[s]?', 'costo[s]?', 'cuesta[n]?', 'vale[n]?',
      'stock', 'disponib[a-z]*', 'exist[a-z]*', 'tienen', 'hay',
      'agregar', 'anadir', 'carrito',
      'teclado[s]?', 'mouse[s]?', 'raton[es]?', 'monitor[es]?', 'pantalla[s]?',
      'laptop[s]?', 'computador[es]?', 'ordenador[es]?', 'audifono[s]?',
      'auricular[es]?', 'parlante[s]?', 'bocina[s]?', 'altavoz[ces]?',
      'cable[s]?', 'cargador[es]?', 'memoria[s]?', 'disco[s]?', 'tarjeta[s]?',
      'impresora[s]?', 'webcam[s]?', 'camara[s]?', 'router[s]?', 'modem[s]?',
      'celular[es]?', 'telefono[s]?', 'tablet[s]?', 'microfono[s]?',
      'producto[s]?', 'articulo[s]?', 'item[s]?'
    ].join('|') +
    `)\\b`,
    'i'
  );

  private normalizeText(str: string): string {
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Quita acentos/diacríticos
      .toLowerCase()
      .trim();
  }

  /**
   * Clasifica la intención de un mensaje.
   */
  classify(message: string): IntentClassification {
    const rawText = (message || '').trim();

    if (rawText.length === 0) {
      return {
        needsTools: false,
        intent: 'empty',
        isShortAnswer: false,
        isProductSearch: false,
      };
    }

    // Normalizar a minúsculas y quitar acentos antes de evaluar las expresiones regulares
    const text = this.normalizeText(rawText);

    // (2) Anti-falso-positivo: si hay verbos/sustantivos de acción, va al loop.
    if (this.ACTION_KEYWORDS_RE.test(text)) {
      const isProductSearch = this.PRODUCT_SEARCH_RE.test(text);
      return {
        needsTools: true,
        intent: isProductSearch ? 'product_search' : 'action',
        isShortAnswer: false,
        isProductSearch,
      };
    }

    // (3) Small-talk puro → sin tools.
    if (this.GREETING_RE.test(text)) {
      return {
        needsTools: false,
        intent: 'greeting',
        isShortAnswer: false,
        isProductSearch: false,
      };
    }
    if (this.FAREWELL_RE.test(text)) {
      return {
        needsTools: false,
        intent: 'farewell',
        isShortAnswer: false,
        isProductSearch: false,
      };
    }
    if (this.THANKS_RE.test(text)) {
      return {
        needsTools: false,
        intent: 'thanks',
        isShortAnswer: false,
        isProductSearch: false,
      };
    }
    if (this.IDENTITY_RE.test(text)) {
      return {
        needsTools: false,
        intent: 'identity',
        isShortAnswer: false,
        isProductSearch: false,
      };
    }

    // (4) Respuesta corta afirmativa/negativa → loop con flag de contexto.
    if (this.SHORT_ANSWER_RE.test(text)) {
      return {
        needsTools: true,
        intent: 'short_answer',
        isShortAnswer: true,
        isProductSearch: false,
      };
    }

    // (5) Default conservador: mensaje no reconocido → al loop con tools.
    return {
      needsTools: true,
      intent: 'unknown',
      isShortAnswer: false,
      isProductSearch: false,
    };
  }

  /**
   * Versión con logging de `classify`. Útil para auditar decisiones del router.
   */
  classifyWithLog(message: string): IntentClassification {
    const result = this.classify(message);
    this.logger.debug(
      `IntentRouter: intent="${result.intent}" needsTools=${result.needsTools} isShortAnswer=${result.isShortAnswer} isProductSearch=${result.isProductSearch} | msg="${message?.slice(0, 60)}"`,
    );
    return result;
  }
}
