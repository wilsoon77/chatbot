import { Injectable, Logger } from '@nestjs/common';
import type { ToolDefinition } from '../llm/llm.interfaces.js';
import { BaseTool } from './base.tool.js';
import {
  BuscarProductosTool,
  VerStockTool,
  ObtenerCategoriasTool,
  AgregarAlCarritoTool,
} from './woocommerce/woocommerce.tool.js';
import { ClarificationTool } from './general/clarification.tool.js';

/**
 * Información de una tool legible para el system prompt.
 * Se usa en `buildToolsPolicyBlock` para generar instrucciones dinámicas.
 */
export interface ToolInfo {
  /** Nombre interno de la tool (ej: "buscar_productos") */
  name: string;
  /** Descripción corta de la capacidad (1 línea, legible para el prompt) */
  promptDescription: string;
}

/**
 * Registry de tools.
 * Gestiona todas las tools disponibles y las filtra por tenant.
 * En Sprint 2, las tools habilitadas se cargarán desde la BD por tenant.
 */
@Injectable()
export class ToolsRegistry {
  private readonly logger = new Logger(ToolsRegistry.name);
  private readonly tools = new Map<string, BaseTool>();

  constructor(
    private readonly buscarProductos: BuscarProductosTool,
    private readonly verStock: VerStockTool,
    private readonly obtenerCategorias: ObtenerCategoriasTool,
    private readonly agregarAlCarrito: AgregarAlCarritoTool,
    private readonly pedirAclaracion: ClarificationTool,
  ) {
    // Registrar todas las tools disponibles
    this.registerTool(this.buscarProductos);
    this.registerTool(this.verStock);
    this.registerTool(this.obtenerCategorias);
    this.registerTool(this.agregarAlCarrito);
    this.registerTool(this.pedirAclaracion);

    this.logger.log(
      `Tools registradas: ${Array.from(this.tools.keys()).join(', ')}`,
    );
  }

  /**
   * Herramientas que ejecutan acciones reales sobre la tienda. Si un tenant no
   * tiene ninguna de estas habilitada, pedir_aclaración no tiene sentido (no hay
   * ninguna acción que aclarar), así que no se inyecta.
   */
  private static readonly ACTION_TOOLS = [
    'buscar_productos',
    'ver_stock',
    'obtener_categorias',
    'agregar_al_carrito',
  ];

  /**
   * Obtiene las definiciones de tools habilitadas para un tenant.
   */
  getToolDefinitions(enabledToolNames: string[]): ToolDefinition[] {
    const definitions = enabledToolNames
      .filter((name) => this.tools.has(name))
      .map((name) => this.tools.get(name)!.getDefinition());

    // Solo inyectamos pedir_aclaracion si el tenant tiene al menos una
    // herramienta de acción habilitada. Sin acciones reales, la aclaración no
    // tiene sentido y solo invita al modelo a abusar de ella.
    const hasActionTool = ToolsRegistry.ACTION_TOOLS.some((n) =>
      enabledToolNames.includes(n),
    );

    if (hasActionTool) {
      const clarificationTool = this.tools.get('pedir_aclaracion');
      if (clarificationTool) {
        definitions.push(clarificationTool.getDefinition());
      }
    }

    return definitions;
  }

  /**
   * Obtiene información legible de las tools habilitadas para un tenant.
   * Se usa en `buildToolsPolicyBlock` para generar las instrucciones del
   * system prompt dinámicamente, en vez de hardcodear nombres de tools.
   *
   * Solo incluye las tools de acción (no `pedir_aclaracion`, que se inyecta
   * automáticamente y no necesita instrucciones de "cuándo usarla" aquí).
   */
  getEnabledToolInfo(enabledToolNames: string[]): ToolInfo[] {
    return enabledToolNames
      .filter((name) => this.tools.has(name) && name !== 'pedir_aclaracion')
      .map((name) => {
        const tool = this.tools.get(name)!;
        return {
          name: tool.name,
          promptDescription: tool.promptDescription || tool.getDefinition().description,
        };
      });
  }

  /**
   * Ejecuta una tool por nombre con los argumentos dados.
   * @throws Error si la tool no existe.
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      this.logger.error(`Tool no encontrada: ${toolName}`);
      return `Error: La herramienta "${toolName}" no está disponible.`;
    }

    // Validación de argumentos usando el esquema Zod de la herramienta
    if (tool.inputSchema) {
      const result = tool.inputSchema.safeParse(args);
      if (!result.success) {
        const errorMessages = result.error.errors
          .map((err) => `- ${err.path.join('.')}: ${err.message}`)
          .join('\n');
        this.logger.warn(
          `Validación fallida para la herramienta "${toolName}":\n${errorMessages}`,
        );
        return `Error de validación en los argumentos de la herramienta "${toolName}":\n${errorMessages}\nPor favor, corrige los argumentos e intenta de nuevo.`;
      }
      // Usar los valores parseados y validados (que incluyen coerción de tipos)
      args = { ...args, ...result.data };
    }

    this.logger.debug(`Ejecutando tool: ${toolName} con args: ${JSON.stringify(args)}`);

    try {
      return await tool.execute(args);
    } catch (error) {
      this.logger.error(`Error ejecutando tool ${toolName}: ${(error as Error).message}`);
      return `Error al ejecutar "${toolName}": ${(error as Error).message}`;
    }
  }

  private registerTool(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
  }
}
