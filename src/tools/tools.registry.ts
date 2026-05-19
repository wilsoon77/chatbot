import { Injectable, Logger } from '@nestjs/common';
import type { ToolDefinition } from '../llm/llm.interfaces.js';
import { BaseTool } from './base.tool.js';
import { BuscarProductosTool } from './woocommerce/woocommerce.tool.js';

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
  ) {
    // Registrar todas las tools disponibles
    this.registerTool(this.buscarProductos);

    this.logger.log(
      `Tools registradas: ${Array.from(this.tools.keys()).join(', ')}`,
    );
  }

  /**
   * Obtiene las definiciones de tools habilitadas para un tenant.
   */
  getToolDefinitions(enabledToolNames: string[]): ToolDefinition[] {
    return enabledToolNames
      .filter((name) => this.tools.has(name))
      .map((name) => this.tools.get(name)!.getDefinition());
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
