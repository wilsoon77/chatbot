import type { ToolDefinition } from '../llm/llm.interfaces.js';
import type { ZodSchema } from 'zod';

/**
 * Clase base abstracta para todas las tools.
 * Cada tool concreta (WooCommerce, Odoo, etc.) debe extender esta clase.
 */
export abstract class BaseTool {
  /** Nombre único de la tool (ej: "buscar_productos") */
  abstract readonly name: string;

  /** Esquema de validación Zod para los argumentos de la tool (opcional) */
  readonly inputSchema?: ZodSchema;

  /** Definición de la tool para enviar al LLM */
  abstract getDefinition(): ToolDefinition;

  /**
   * Ejecuta la tool con los argumentos dados.
   * @returns El resultado como string (se envía al LLM como contenido del message tool).
   */
  abstract execute(args: Record<string, unknown>): Promise<string>;
}
