/**
 * model-params.ts
 *
 * Centraliza la lectura de parámetros de generación (temperatura, top_p) para
 * que todos los providers (Groq, OpenAI, Ollama, Google) usen los mismos
 * valores y el comportamiento del asistente sea consistente al cambiar de
 * proveedor.
 *
 * Antes de este helper, cada provider usaba su propio valor hardcoded:
 * Groq y OpenAI usaban 0.1, Ollama y Google no seteaban nada (default).
 * Ahora todos leen la misma variable de entorno `LLM_TEMPERATURE`.
 */

/**
 * Temperatura por defecto para generación. Baja deliberadamente para que el
 * comportamiento de llamadas a herramientas sea consistente y predecible.
 */
export const DEFAULT_TEMPERATURE = 0.2;

/**
 * Resuelve la temperatura a usar desde la variable de entorno `LLM_TEMPERATURE`,
 * con validación de rango [0, 2]. Si el valor no es válido, usa el default.
 */
export function resolveTemperature(): number {
  const raw = Number(process.env.LLM_TEMPERATURE);
  if (Number.isNaN(raw) || raw < 0 || raw > 2) {
    return DEFAULT_TEMPERATURE;
  }
  return raw;
}

/**
 * Timeout por defecto para una llamada al LLM (en milisegundos).
 * 120s es seguro para modelos locales grandes (ej: Qwen3 32B) que pueden
 * tardar bastante vía tunel (ngrok) o en hardware modesto.
 */
export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Resuelve el timeout desde la variable de entorno `LLM_TIMEOUT_MS`.
 * Permite ajustar el tiempo máximo de espera por llamada sin tocar código —
 * útil para pruebas con modelos autoalojados de distintos tamaños/latencias.
 * Si el valor no es válido o no está seteado, usa el default de 120s.
 */
export function resolveTimeoutMs(): number {
  const raw = Number(process.env.LLM_TIMEOUT_MS);
  if (Number.isNaN(raw) || raw <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return raw;
}
