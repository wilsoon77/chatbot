import type { ToolDefinition } from '../llm/llm.interfaces.js';

/**
 * Clase base abstracta para todas las tools.
 * Cada tool concreta (WooCommerce, Odoo, etc.) debe extender esta clase.
 */
export abstract class BaseTool {
  /** Nombre único de la tool (ej: "buscar_productos") */
  abstract readonly name: string;

  /** Definición de la tool para enviar al LLM */
  abstract getDefinition(): ToolDefinition;

  /**
   * Ejecuta la tool con los argumentos dados.
   * @returns El resultado como string (se envía al LLM como contenido del message tool).
   */
  abstract execute(args: Record<string, unknown>): Promise<string>;
}
