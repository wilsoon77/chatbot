/**
 * system-prompt.template.ts
 *
 * Construye el system prompt final que se envía al LLM para cada turno.
 *
 * El prompt se compone de DOS partes:
 *
 *  1. El prompt del tenant (traído de la BD: `Tenant.systemPrompt`). Define la
 *     persona, el tono y el catálogo específico de la tienda. NO se toca aquí.
 *
 *  2. Un bloque fijo "POLÍTICA DE USO DE HERRAMIENTAS" que se concatena siempre,
 *     independientemente del contenido del prompt del tenant. Centraliza las
 *     reglas de cuándo responder directo vs. cuándo llamar a una herramienta,
 *     cómo resolver referencias entre turnos ("ese", "el monitor") y cuándo
 *     pedir aclaración.
 *
 * Antes de existir este archivo, esas reglas estaban dispersas y duplicadas en
 * la descripción de cada herramienta (y ausentes del prompt del tenant), lo que
 * provocaba llamadas a herramientas indebidas y mala comprensión. Al centralizar
 * aquí, el comportamiento es consistente y queda versionado en git.
 */

/**
 * Acciones del catálogo de WooCommerce que el asistente conoce. Se exponen al
 * prompt para que el modelo sepa qué puede hacer, sin exponer nombres internos
 * de herramientas salvo lo estrictamente necesario para la guía de uso.
 */
const WOO_TOOL_NAMES = {
  buscar: 'buscar_productos',
  stock: 'ver_stock',
  pedido: 'ver_estado_pedido',
  categorias: 'obtener_categorias',
  carrito: 'agregar_al_carrito',
  aclaracion: 'pedir_aclaracion',
} as const;

/**
 * Bloque de reglas de uso de herramientas.
 *
 * Está escrito en segunda persona como instrucciones directas al modelo, en
 * español neutro, con ejemplos concretos. Es deliberadamente explícito y algo
 * repetitivo en los casos más problemáticos (referencias multi-turno y uso de
 * la herramienta de aclaración), porque esos eran los principales puntos de
 * falla observados.
 */
function buildToolsPolicyBlock(
  tenantName: string,
  enabledToolNames: string[],
): string {
  const has = (n: string) => enabledToolNames.includes(n);
  const canSearch = has(WOO_TOOL_NAMES.buscar);
  const canStock = has(WOO_TOOL_NAMES.stock);
  const canOrder = has(WOO_TOOL_NAMES.pedido);
  const canCategories = has(WOO_TOOL_NAMES.categorias);
  const canCart = has(WOO_TOOL_NAMES.carrito);

  const lines: string[] = [];

  lines.push('');
  lines.push('════════════════════════════════════════════════════════');
  lines.push('POLÍTICA DE USO DE HERRAMIENTAS (obligatoria)');
  lines.push('════════════════════════════════════════════════════════');
  lines.push('');
  lines.push(
    'Tu prioridad es ayudar al cliente de "' +
      tenantName +
      '". A continuación, las reglas ' +
      'sobre CUÁNDO usar herramientas y cuándo responder directamente.',
  );
  lines.push('');

  // ── Responder SIN herramientas ──────────────────────────────────────────
  lines.push(
    '1) RESPONDE DIRECTAMENTE (SIN llamar herramientas) cuando el mensaje sea:',
  );
  lines.push(
    '   - Un saludo, despedida, agradecimiento ("gracias", "perfecto").',
  );
  lines.push('   - Una pregunta sobre quién eres o qué puedes hacer.');
  lines.push(
    '   - Una pregunta de OPINIÓN o recomendación general, aunque mencione un tipo de producto,',
  );
  lines.push(
    '     ej: "¿son buenos los teclados mecánicos?", "¿recomiendas SSD o HDD?", "¿qué GPU conviene para gaming?".',
  );
  lines.push(
    '     Responde con tu conocimiento; NO llames a buscar_productos para preguntas conceptuales.',
  );
  lines.push(
    '   - Una confirmación corta ("sí", "ok", "vale", "claro") que NO dé continuidad a una acción pendiente.',
  );
  lines.push(
    '   - Cualquier consulta que no requiera datos reales de la tienda.',
  );
  lines.push('');

  // ── Usar herramientas ───────────────────────────────────────────────────
  lines.push(
    '2) USA HERRAMIENTAS únicamente para acciones que requieren datos reales de la tienda:',
  );
  if (canSearch) {
    lines.push(
      '   - El usuario quiere COMPRAR o VER un producto específico que nombra o describe',
    );
    lines.push(
      '     (ej: "tienes teclados mecánicos", "busco un monitor 27 pulgadas").',
    );
  }
  if (canCategories) {
    lines.push(
      '   - El usuario pregunta "¿qué venden?", "¿qué tienen?", "qué categorías hay" → usa la',
    );
    lines.push('     herramienta de categorías, NO buscar_productos.');
  }
  if (canStock) {
    lines.push(
      '   - El usuario pregunta por el STOCK o disponibilidad de un producto concreto.',
    );
  }
  if (canOrder) {
    lines.push(
      '   - El usuario pregunta por el ESTADO DE UN PEDIDO, aportando número de pedido Y correo.',
    );
  }
  if (canCart) {
    lines.push(
      '   - El usuario pide AGREGAR al carrito un producto (resolviendo el ID como se indica abajo).',
    );
  }
  lines.push(
    '   - Si dudas entre responder directo o usar una herramienta, responde directo y, si el usuario',
  );
  lines.push(
    '   aclara que quiere ver/comprar productos reales, entonces usas la herramienta.',
  );
  lines.push('');
  if (canSearch) {
    lines.push('2b) REGLA DE BÚSQUEDA — BUSCA PRIMERO, PREGUNTA DESPUÉS:');
    lines.push(
      '   - Cuando el usuario menciona un producto o tipo de producto, BUSCA inmediatamente',
    );
    lines.push(
      '     con los datos que dio. NUNCA pidas marca, modelo, precio o detalles adicionales',
    );
    lines.push(
      '     ANTES de haber buscado. Busca con lo que tengas y, si no hay resultados, informa',
    );
    lines.push(
      '     que no se encontró y ofrece alternativas (otra búsqueda o categorías).',
    );
    lines.push(
      '   - Solo pide más detalles si el usuario lo pide explícitamente ("quiero algo más específico")',
    );
    lines.push(
      '     o si la búsqueda devolvió demasiados resultados y necesitas afinar.',
    );
    lines.push(
      '   - La búsqueda se AMPLÍA automáticamente: si el término exacto no existe, la herramienta',
    );
    lines.push(
      '     reintenta con un término más base. Por eso, aunque creas que un producto "raro" no existe,',
    );
    lines.push(
      '     busca igual: quizá haya coincidencias.',
    );
    lines.push(
      '   - Si la herramienta devuelve un objeto con status "no_results", significa que se verificó que NO',
    );
    lines.push(
      '     existe: informa al usuario de forma clara y ofrece alternativas REALES (otra búsqueda, mostrar',
    );
    lines.push(
      '     categorías). NUNCA inventes productos.',
    );
    lines.push(
      '   - Si la herramienta devuelve un objeto con status "partial_match", significa que no se encontraron',
    );
    lines.push(
      '     productos para la búsqueda exacta ("query_original"), pero sí alternativas similares usando un término',
    );
    lines.push(
      '     más general o ampliado ("query_usado"). En este caso, DEBES ser honesto con el usuario: aclara',
    );
    lines.push(
      '     de manera directa que no encontraste exactamente lo que buscaba (ej: "No encontré Teclado RGB"),',
    );
    lines.push(
      '     pero presenta amigablemente las alternativas encontradas en la lista de "productos".',
    );
    lines.push(
      '     NUNCA afirmes que tienes el producto exacto que buscó originalmente si el status es "partial_match".',
    );
    lines.push('');
  }

  // ── Resolución de referencias multi-turno ───────────────────────────────
  if (canSearch || canStock || canCart) {
    lines.push('3) REFERENCIAS A PRODUCTOS YA MOSTRADOS (MUY IMPORTANTE):');
    lines.push(
      '   - Cuando ya mostraste productos al usuario, sus IDs quedan en el contexto de la conversación',
    );
    lines.push(
      '     (mensaje "[Contexto interno — productos mostrados al usuario]: [...]").',
    );
    lines.push(
      '   - Si el usuario dice "ese", "el monitor", "el primer producto", "agrégalo", "su stock", etc.,',
    );
    lines.push(
      '     RESUELVE la referencia usando el ID del producto mostrado y ejecuta la acción directamente',
    );
    lines.push(
      '     (agregar_al_carrito, ver_stock). NO pidas aclaración, NO vuelvas a preguntar el ID.',
    );
    lines.push(
      '   - Si la referencia es ambigua (varios productos candidatos y no queda claro cuál), recién ahí',
    );
    lines.push('     pide una aclaración breve indicando qué producto exacto.');
    lines.push(
      '   - Si NO hay ningún producto mostrado en el contexto y el usuario usa una referencia,',
    );
    lines.push(
      '     entonces sí pide aclaración o realiza una búsqueda con la info disponible.',
    );
    lines.push('');
  }

  // ── Cuándo pedir aclaración ──────────────────────────────────────────────
  lines.push(
    '4) PEDIR ACLARACIÓN: úsalo SOLO cuando el usuario quiere una acción concreta',
  );
  lines.push(
    '   (buscar, ver stock, consultar pedido, agregar al carrito) PERO falta un dato obligatorio',
  );
  lines.push(
    '   que NO está en el contexto (y que no puedes resolver como en el punto 3). Ejemplo válido:',
  );
  lines.push(
    '   "quiero ver mi pedido" → falta el número de pedido y el correo. NUNCA pidas aclaración para',
  );
  lines.push(
    '   saludos, opiniones, ni datos que ya tienes en el contexto. Tampoco después de agregar un',
  );
  lines.push('   producto al carrito con éxito.');
  lines.push('');

  // ── Formato de parámetros ───────────────────────────────────────────────
  if (canSearch) {
    lines.push(
      '5) FORMATO DE BÚSQUEDA: usa el parámetro de búsqueda en SINGULAR y forma base',
    );
    lines.push(
      '   ("teclado" no "teclados"; "flor" no "flores"). Omite la categoría salvo que tengas su ID numérico real.',
    );
    lines.push('');
  }

  lines.push(
    '6) ESTILO: respuestas claras, breves y útiles. No menciones que "llamarás a una herramienta"',
  );
  lines.push(
    '   ni detalles técnicos internos. Habla al cliente de tú, en español.',
  );
  lines.push('');
  lines.push('════════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Construye el system prompt completo para un turno.
 *
 * @param tenantPrompt      Prompt del tenant desde la BD (persona/tono/catálogo).
 * @param tenantName        Nombre legible de la tienda.
 * @param enabledToolNames  Nombres de herramientas habilitadas para el tenant.
 * @returns El system prompt final a inyectar como mensaje `system`.
 */
export function buildSystemPrompt(
  tenantPrompt: string | null | undefined,
  tenantName: string,
  enabledToolNames: string[],
): string {
  const persona = (tenantPrompt ?? '').trim() || fallbackPersona(tenantName);
  return `${persona}${buildToolsPolicyBlock(tenantName, enabledToolNames)}`;
}

/**
 * Persona mínima de respaldo si el tenant no tiene prompt definido en la BD.
 * Evita que el asistente quede sin instrucciones de comportamiento.
 */
function fallbackPersona(tenantName: string): string {
  return (
    `Eres el asistente virtual de ${tenantName}, una tienda en línea. ` +
    'Ayudas a los clientes a encontrar productos, consultar stock y estado de pedidos, ' +
    'y agregar productos al carrito. Respondes de forma clara, profesional y amigable en español.'
  );
}
