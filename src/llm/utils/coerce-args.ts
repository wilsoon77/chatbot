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

/**
 * Limpia y optimiza el contenido de respuesta de una herramienta (especialmente buscar_productos)
 * antes de enviarlo al LLM externo (Groq/OpenAI) para evitar desperdicio de tokens y fallos de límite TPM.
 *
 * Remueve imágenes en formato base64 y recorta descripciones largas de productos.
 */
export function cleanToolContentForLlm(content: string): string {
  try {
    const parsed = JSON.parse(content);

    const cleanProduct = (p: any) => {
      if (typeof p !== 'object' || p === null) return p;
      const cleaned = { ...p };
      
      // 1. Eliminar imágenes base64 (empiezan por data:)
      if (typeof cleaned.imagen === 'string' && cleaned.imagen.startsWith('data:')) {
        cleaned.imagen = null;
      }
      // 2. Recortar descripción excesivamente larga
      if (typeof cleaned.descripcion === 'string' && cleaned.descripcion.length > 150) {
        cleaned.descripcion = cleaned.descripcion.slice(0, 150) + '... (recortado para optimizar tokens)';
      }
      return cleaned;
    };

    if (Array.isArray(parsed)) {
      return JSON.stringify(parsed.map(cleanProduct));
    } else if (parsed && typeof parsed === 'object') {
      // Si tiene estructura de partial_match o similar
      if (Array.isArray(parsed.productos)) {
        parsed.productos = parsed.productos.map(cleanProduct);
      }
      // Si es un producto único
      const cleanedObj = cleanProduct(parsed);
      return JSON.stringify(cleanedObj);
    }
  } catch {
    // Si no es JSON válido o falla, retornar el contenido original
  }
  return content;
}
