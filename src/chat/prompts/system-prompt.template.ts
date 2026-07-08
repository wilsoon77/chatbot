import type { ToolInfo } from '../../tools/tools.registry.js';
import type { CategoryDto } from '../../commerce/commerce.interfaces.js';

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
 *
 * Desde la refactorización a prompt dinámico, el bloque de política se genera
 * desde `ToolInfo[]` (información real de las tools habilitadas del tenant),
 * eliminando la constante hardcodeada `WOO_TOOL_NAMES`. Esto permite que
 * cualquier tool nueva (Odoo, etc.) se refleje automáticamente en el prompt.
 */

/**
 * Bloque de reglas de uso de herramientas.
 *
 * Se genera dinámicamente desde `ToolInfo[]` (información real de las tools
 * habilitadas del tenant), en vez de una constante hardcodeada. Esto permite
 * que cualquier tool nueva se refleje automáticamente en el prompt.
 *
 * Está escrito en segunda persona como instrucciones directas al modelo, en
 * español neutro, con ejemplos concretos. Es deliberadamente explícito y algo
 * repetitivo en los casos más problemáticos (referencias multi-turno y uso de
 * la herramienta de aclaración), porque esos eran los principales puntos de
 * falla observados.
 */
function buildToolsPolicyBlock(
  tenantName: string,
  toolInfo: ToolInfo[],
): string {
  // Helpers para detectar capabilities por nombre de tool.
  const has = (n: string) => toolInfo.some((t) => t.name === n);
  const canSearch = has('buscar_productos');
  const canStock = has('ver_stock');
  const canCategories = has('obtener_categorias');
  const canCart = has('agregar_al_carrito');
  const hasActionTools = toolInfo.length > 0;

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
  if (canCart) {
    lines.push(
      '   - El usuario pide AGREGAR al carrito un producto (resolviendo el ID como se indica abajo).',
    );
  }
  // Listado dinámico de capacidades disponibles para este tenant.
  if (hasActionTools) {
    lines.push('   - Herramientas disponibles para este asistente:');
    for (const t of toolInfo) {
      lines.push(`     • ${t.promptDescription}`);
    }
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
    '   (buscar, ver stock, agregar al carrito) PERO falta un dato obligatorio',
  );
  lines.push(
    '   que NO está en el contexto (y que no puedes resolver como en el punto 3).',
  );
  lines.push(
    '   NUNCA pidas aclaración para saludos, opiniones, ni datos que ya tienes en el contexto.',
  );
  lines.push(
    '   Tampoco después de agregar un producto al carrito con éxito.',
  );
  lines.push('');

  // ── Formato de parámetros ───────────────────────────────────────────────
  if (canSearch) {
    lines.push(
      '5) FORMATO DE BÚSQUEDA: usa el parámetro de búsqueda en SINGULAR y forma base',
    );
    lines.push(
      '   ("teclado" no "teclados"; "flor" no "flores").',
    );
    lines.push(
      '   Si el usuario nombra una categoría que conoces (del catálogo pre-cargado o de obtener_categorias),',
    );
    lines.push(
      '   pasa ese nombre o su ID en "categoria" y deja "query" vacío. El parámetro "categoria" acepta',
    );
    lines.push(
      '   tanto el nombre legible (ej: "Monitores") como el ID numérico (ej: "17").',
    );
    lines.push('');
  }

  lines.push(
    '6) PROHIBICIÓN DE REPETIR EL SALUDO DE BIENVENIDA (CRÍTICO):',
  );
  lines.push(
    '   - BAJO NINGUNA CIRCUNSTANCIA repitas tu mensaje de presentación o de saludo inicial (ej: "¡Hola! Soy el asistente virtual de...")',
  );
  lines.push(
    '     en respuestas a búsquedas, consultas o turnos intermedios del chat.',
  );
  lines.push(
    '   - Si el usuario te hace una pregunta de producto ("¿tienen monitores?", "busco teclado") o se ejecuta una herramienta,',
  );
  lines.push(
    '     tu respuesta DEBE responder directamente a la consulta o listar los productos encontrados. Está ESTRICTAMENTE PROHIBIDO',
  );
  lines.push(
    '     volver a presentarte, dar la bienvenida, o enumerar lo que puedes hacer (como "Puedo ayudarte a buscar productos, consultar stock...").',
  );
  lines.push(
    '   - El saludo inicial de bienvenida de los ejemplos SOLO se utiliza en el primer mensaje de la conversación si el usuario saluda.',
  );
  lines.push(
    '   - Sé conciso, breve y profesional. Habla al cliente de tú, en español.',
  );
  lines.push('');
  lines.push('════════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Construye el bloque de catálogo de la tienda con las categorías disponibles.
 * Se inyecta en el system prompt para que el LLM conozca las categorías ANTES
 * de cualquier tool call, permitiendo responder "¿qué venden?" directamente y
 * pasar nombres de categoría en buscar_productos sin un round-trip previo.
 *
 * Si no hay categorías (la tienda no las devolvió o falló), devuelve string
 * vacío (graceful degradation).
 */
function buildCatalogBlock(categories: CategoryDto[] | null): string {
  if (!categories || categories.length === 0) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push('════════════════════════════════════════════════════════');
  lines.push('CATÁLOGO DE LA TIENDA (contexto pre-cargado)');
  lines.push('════════════════════════════════════════════════════════');
  lines.push('');
  lines.push('Las siguientes categorías están disponibles en la tienda:');
  for (const c of categories) {
    lines.push(`  • ${c.nombre} (ID: ${c.id}) — ${c.cantidad} productos`);
  }
  lines.push('');
  lines.push(
    'Puedes mencionar estas categorías cuando el usuario pregunte "¿qué venden?" o "¿qué tienen?".',
  );
  lines.push(
    'Si el usuario quiere ver los productos de una categoría, pasa el nombre o el ID en el',
  );
  lines.push(
    'parámetro "categoria" de buscar_productos (el sistema lo resuelve automáticamente).',
  );
  lines.push('');
  lines.push('════════════════════════════════════════════════════════');

  return lines.join('\n');
}

/**
 * Construye el system prompt completo para un turno.
 *
 * @param tenantPrompt  Prompt del tenant desde la BD (persona/tono/catálogo).
 * @param tenantName    Nombre legible de la tienda.
 * @param toolInfo      Información de las tools habilitadas (dinámica).
 * @param categories    Categorías disponibles para inyectar como contexto
 *                      (opcional — si es null, se omite el bloque de catálogo).
 * @returns El system prompt final a inyectar como mensaje `system`.
 */
export function buildSystemPrompt(
  tenantPrompt: string | null | undefined,
  tenantName: string,
  toolInfo: ToolInfo[],
  categories?: CategoryDto[] | null,
): string {
  const persona = (tenantPrompt ?? '').trim() || fallbackPersona(tenantName);
  return `${persona}${buildCatalogBlock(categories ?? null)}${buildToolsPolicyBlock(tenantName, toolInfo)}`;
}

/**
 * Persona mínima de respaldo si el tenant no tiene prompt definido en la BD.
 * Evita que el asistente quede sin instrucciones de comportamiento.
 */
function fallbackPersona(tenantName: string): string {
  return (
    `Eres el asistente virtual de ${tenantName}, una tienda en línea. ` +
    'Ayudas a los clientes a encontrar productos, consultar stock ' +
    'y agregar productos al carrito. Respondes de forma clara, profesional y amigable en español.'
  );
}
