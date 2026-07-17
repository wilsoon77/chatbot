import { Injectable, Logger } from '@nestjs/common';
import type { ToolDefinition } from '../../llm/llm.interfaces.js';
import { BaseTool } from '../base.tool.js';
import { ConnectorRegistry } from '../../commerce/connector.registry.js';
import {
  buscarProductosSchema,
  verStockSchema,
  obtenerCategoriasSchema,
  agregarAlCarritoSchema,
} from '../schemas/woocommerce.schemas.js';

export function removeDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

@Injectable()
export class BuscarProductosTool extends BaseTool {
  private readonly logger = new Logger(BuscarProductosTool.name);
  readonly name = 'buscar_productos';
  readonly inputSchema = buscarProductosSchema;
  readonly promptDescription = 'buscar y ver productos por nombre o categoría';

  constructor(private readonly connectors: ConnectorRegistry) {
    super();
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Busca productos en la tienda WooCommerce por nombre, palabra clave o categoría. ' +
        'Puedes buscar por término de texto usando "query", por categoría usando "categoria", o ambos. ' +
        'Si el usuario pide ver el catálogo general, navegar la tienda de manera libre, o si no especifica un término claro, ' +
        'puedes omitir ambos parámetros ("query" y "categoria") para listar los productos destacados y recientes de la tienda. ' +
        'Si el usuario pide ver los productos de una categoría, usa "categoria" con el nombre o el ID numérico de la categoría ' +
        '(ambos funcionan — el sistema resuelve el nombre al ID automáticamente) y deja "query" vacío. ' +
        'Si el usuario busca un producto por características o atributos específicos (ej: "teclado con switches intercambiables" o "mouse bluetooth"), ' +
        'DEBES incluir estas palabras clave de atributos en "query" (ej: "teclado switches intercambiables") de forma descriptiva, excluyendo preposiciones como "con" o "de". ' +
        'NUNCA pidas datos adicionales antes de buscar: busca primero con lo que el usuario dio.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Término de búsqueda principal. Opcional. ' +
              'Normaliza las palabras a su forma singular (ej: "teclado" en lugar de "teclados"). ' +
              'Incluye palabras clave de atributos descriptivos si el usuario los especificó.',
          },
          categoria: {
            type: 'string',
            description:
              'Nombre o ID numérico de la categoría (ej: "Monitores" o "17"). Opcional. ' +
              'Acepta el nombre legible de la categoría (el sistema lo resuelve a ID automáticamente) ' +
              'o el ID numérico retornado por obtener_categorias o el catálogo pre-cargado. ' +
              'Úsalo para listar todos los productos de una categoría específica sin necesidad de un query de búsqueda.',
          },
          limite: {
            type: ['integer', 'string'],
            description:
              'Cantidad máxima de resultados a retornar (por defecto 5, máximo 10). DEBE ser un número entero.',
          },
        },
        required: [],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const tenantId = String(args.tenant_id || '');
    this.logger.log(`Tenant recibido para WooCommerce: ${tenantId}`);

    const query = String(args.query || '').trim();
    const limite = Math.min(Number(args.limite) || 5, 10);
    const categoria = args.categoria ? String(args.categoria) : undefined;

    if (!tenantId) {
      return JSON.stringify({ status: 'error', mensaje: 'Falta tenant_id.' });
    }

    try {
      const connector = await this.connectors.getConnector(tenantId);
      const result = await connector.buscarProductos(query, { limite, categoria });

      if (!result) {
        const payload = {
          status: 'no_results' as const,
          query,
          sugerencia:
            `No se encontraron productos que coincidan con "${query}". ` +
            'Ofrece alternativas reales: sugiere buscar otro término, muestra ' +
            'categorías disponibles con obtener_categorias, o pregunta por un ' +
            'tipo de producto similar. NO inventes productos.',
        };
        return JSON.stringify(payload);
      }

      // En la interfaz multi-conector, searchProducts/buscarProductos devuelve CanonicalProduct[] directamente.
      // Si la cantidad de productos devuelta es 0 o null, lo tratamos como no_results.
      if (result.length === 0) {
        const payload = {
          status: 'no_results' as const,
          query,
          sugerencia: `No se encontraron productos para "${query}".`,
        };
        return JSON.stringify(payload);
      }

      // WooCommerceConnector maneja internamente la coincidencia parcial y devuelve una marca de usedFallback.
      // Para integrarlo limpiamente, el connector de WooCommerce devuelve los productos mapeados.
      // Para simular partial_match si es necesario, WooCommerceConnector puede exponer el estado o simplemente
      // delegar la salida de productos. Retornamos la lista de productos serializada.
      return JSON.stringify(result);
    } catch (error) {
      this.logger.error(
        `Error en la herramienta buscar_productos: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return JSON.stringify({
        status: 'error',
        mensaje: `Error al buscar productos: ${(error as Error).message}`,
      });
    }
  }
}

// ─── Tool: ver_stock ────────────────────────────────────────

@Injectable()
export class VerStockTool extends BaseTool {
  private readonly logger = new Logger(VerStockTool.name);
  readonly name = 'ver_stock';
  readonly inputSchema = verStockSchema;
  readonly promptDescription = 'consultar el stock o disponibilidad de un producto';

  constructor(private readonly connectors: ConnectorRegistry) {
    super();
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Obtiene las existencias físicas e inventario disponible de un producto específico mediante su ID. ' +
        'El producto_id DEBE provenir de una búsqueda previa (buscar_productos) o del contexto de productos ' +
        'ya mostrados al usuario. Si el usuario pregunta por el stock de un producto que aún no se ha mostrado ' +
        'ni se ha buscado, primero llama a buscar_productos. NO pidas al usuario un ID numérico que ya tienes ' +
        'en el contexto; resuélvelo directamente.',
      parameters: {
        type: 'object',
        properties: {
          producto_id: {
            type: ['integer', 'string'],
            description:
              'El ID numérico del producto (ej: 42, 107). Extraído del producto retornado previamente.',
          },
        },
        required: ['producto_id'],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const tenantId = String(args.tenant_id || '');
    const productId = String(args.producto_id);

    if (!tenantId) return 'Error: falta tenant_id.';
    if (!productId) return 'Error: producto_id inválido.';

    try {
      const connector = await this.connectors.getConnector(tenantId);
      const stockInfo = await connector.verStock(productId);
      return JSON.stringify(stockInfo);
    } catch (error) {
      this.logger.error(
        `Error en la herramienta ver_stock: ${(error as Error).message}`,
      );
      return `Error al consultar stock: ${(error as Error).message}`;
    }
  }
}

// ─── Tool: obtener_categorias ──────────────────────────────

@Injectable()
export class ObtenerCategoriasTool extends BaseTool {
  private readonly logger = new Logger(ObtenerCategoriasTool.name);
  readonly name = 'obtener_categorias';
  readonly inputSchema = obtenerCategoriasSchema;
  readonly promptDescription = 'listar las categorías de productos disponibles';

  constructor(private readonly connectors: ConnectorRegistry) {
    super();
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Obtiene las categorías de productos disponibles en la tienda con sus respectivos IDs numéricos y conteo de productos.',
      parameters: {
        type: 'object',
        properties: {},
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const tenantId = String(args.tenant_id || '');
    if (!tenantId) return 'Error: falta tenant_id.';

    try {
      const connector = await this.connectors.getConnector(tenantId);
      const categories = await connector.obtenerCategorias();
      return JSON.stringify(categories);
    } catch (error) {
      this.logger.error(
        `Error en la herramienta obtener_categorias: ${(error as Error).message}`,
      );
      return `Error al obtener categorías: ${(error as Error).message}`;
    }
  }
}

// ─── Tool: agregar_al_carrito ───────────────────────────────

@Injectable()
export class AgregarAlCarritoTool extends BaseTool {
  readonly name = 'agregar_al_carrito';
  readonly inputSchema = agregarAlCarritoSchema;
  readonly promptDescription = 'agregar un producto al carrito';

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Solicita agregar un producto al carrito de compras del usuario mediante su ID de producto. ' +
        'El producto_id DEBE provenir de una búsqueda previa (buscar_productos) o del contexto de productos ' +
        'ya mostrados al usuario: si el usuario dice "ese", "el monitor", "agrégalo", extrae el ID del contexto. ' +
        'Esta herramienta NO modifica el carrito directamente: devuelve una acción que el cliente confirma ' +
        'en su interfaz, así que tras llamarla solo confirma al usuario que se agregará. NO la uses si el ' +
        'producto no se ha mostrado ni buscado todavía (primero busca).',
      parameters: {
        type: 'object',
        properties: {
          producto_id: {
            type: ['integer', 'string'],
            description: 'El ID numérico del producto a agregar.',
          },
          cantidad: {
            type: ['integer', 'string'],
            description: 'Cantidad de unidades a agregar (por defecto 1).',
          },
        },
        required: ['producto_id'],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const productId = String(args.producto_id || '').trim();
    const quantity = Math.max(Number(args.cantidad) || 1, 1);

    if (!productId) {
      return 'Error: El ID del producto no es válido o está vacío.';
    }

    const resultPayload = {
      status: 'pending_client_action',
      producto_id: productId,
      cantidad: quantity,
      mensaje: `Solicitud procesada: se agregará el producto ID ${productId} (cantidad: ${quantity}) al carrito del cliente.`,
    };

    return JSON.stringify(resultPayload);
  }
}
