/**
 * coerce-args.ts
 *
 * Helper compartido para normalizar los argumentos de tool calls que llegan de
 * los distintos proveedores de LLM.
 *
 * Problema que resuelve: algunos modelos (especialmente vía Ollama/OpenAI-
 * compatible) emiten argumentos numéricos como strings, p.ej.
 * `{"producto_id": "123"}` en lugar de `{"producto_id": 123}`. Eso degrada la
 * comprensión: las herramientas esperan números y fallan o coercen mal.
 *
 * Históricamente solo el provider de Groq aplicaba esta corrección
 * (`coerceNumericArgs`). Al moverlo aquí, todos los providers (Groq, OpenAI,
 * Ollama) aplican la misma normalización y el comportamiento es consistente al
 * cambiar de proveedor.
 */

/**
 * Convierte strings que representan enteros (p.ej. "123") a números reales.
 * Cualquier otro valor se deja intacto.
 *
 * @param args Argumentos crudos parseados del JSON del modelo. Puede ser null.
 * @returns Copia normalizada de los argumentos.
 */
export function coerceNumericArgs(
  args: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!args) {
    return {};
  }
  const coerced: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      coerced[key] = parseInt(value.trim(), 10);
    } else {
      coerced[key] = value;
    }
  }
  return coerced;
}
