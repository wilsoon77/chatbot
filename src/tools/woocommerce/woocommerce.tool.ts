import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../common/crypto/crypto.service.js'; // 👈 agregado
import type { ToolDefinition } from '../../llm/llm.interfaces.js';
import { BaseTool } from '../base.tool.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { COMMERCE_CONNECTOR_TOKEN } from '../../commerce/commerce.interfaces.js';
import type { ICommerceConnector } from '../../commerce/commerce.interfaces.js';
import {
  buscarProductosSchema,
  verStockSchema,
  verEstadoPedidoSchema,
  obtenerCategoriasSchema,
  agregarAlCarritoSchema,
} from '../schemas/woocommerce.schemas.js';

/**
 * Cliente HTTP para la API REST de WooCommerce.
 * Carga las credenciales dinámicamente desde la base de datos para cada tenant.
 */
@Injectable()
export class WooCommerceClient {
  private readonly logger = new Logger(WooCommerceClient.name);
  private readonly defaultCurrency: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cryptoService: CryptoService, // 👈 agregado
  ) {
    this.defaultCurrency = this.config.get<string>('WOO_CURRENCY') || '$';
  }

  /**
   * Obtiene el símbolo de moneda configurado en las variables de entorno.
   */
  getCurrencySymbol(): string {
    return this.defaultCurrency;
  }

  /**
   * Obtiene la configuración del tenant desde la base de datos.
   * Descifra las credenciales de WooCommerce antes de retornarlas.
   */
  private async getTenantConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      // 👈 reemplaza this.tenantsService
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new Error(`No se encontró el tenant con ID: ${tenantId}`);
    }

    if (
      !tenant.woocommerceUrl ||
      !tenant.consumerKey ||
      !tenant.consumerSecret
    ) {
      throw new Error(
        `El tenant "${tenant.nombre}" no tiene configuradas las credenciales de WooCommerce.`,
      );
    }

    // Descifrar credenciales antes de usarlas
    return {
      ...tenant,
      consumerKey: this.cryptoService.decrypt(tenant.consumerKey), // 👈 agregado
      consumerSecret: this.cryptoService.decrypt(tenant.consumerSecret), // 👈 agregado
    };
  }

  /**
   * Realiza una petición GET a la API de WooCommerce.
   */
  async get<T = unknown>(
    tenantId: string,
    endpoint: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const tenant = await this.getTenantConfig(tenantId);

    // Asegura que la URL base termine con barra para que las rutas relativas funcionen
    let base = tenant.woocommerceUrl;
    if (!base.endsWith('/')) {
      base += '/';
    }

    const url = new URL(`wp-json/wc/v3/${endpoint}`, base);

    // Autenticación por parámetros de consulta (Consumer Key/Secret)
    url.searchParams.set('consumer_key', tenant.consumerKey);
    url.searchParams.set('consumer_secret', tenant.consumerSecret);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    this.logger.debug(
      `WooCommerce GET [${tenant.nombre}]: ${url.pathname}${url.search}`,
    );

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `WooCommerce API error (${response.status}): ${errorText}`,
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(
        `El servidor de WordPress devolvió HTML en lugar de JSON (Content-Type: ${contentType}). ` +
          `Inicio de la respuesta: ${text.substring(0, 300).replace(/\s+/g, ' ')}...`,
      );
    }

    return response.json() as Promise<T>;
  }
}

export function removeDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

@Injectable()
export class BuscarProductosTool extends BaseTool {
  private readonly logger = new Logger(BuscarProductosTool.name);
  readonly name = 'buscar_productos';
  readonly inputSchema = buscarProductosSchema;

  constructor(
    @Inject(COMMERCE_CONNECTOR_TOKEN)
    private readonly commerce: ICommerceConnector,
  ) {
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
        'Si el usuario pide ver los productos de una categoría que listaste previamente, usa "categoria" con el ID numérico correspondiente y deja "query" vacío. ' +
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
              'ID numérico de la categoría en WooCommerce (ej: "17", "42"). Opcional. ' +
              'Usa el ID numérico exacto retornado previamente por la herramienta obtener_categorias. ' +
              'Es extremadamente útil para listar todos los productos de una categoría específica sin necesidad de un query de búsqueda.',
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
      const result = await this.commerce.searchProducts(tenantId, query, categoria, limite);

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

      const isPartialMatch = result.usedFallback;

      if (isPartialMatch) {
        const payload = {
          status: 'partial_match' as const,
          query_original: query,
          nota: `No se encontraron productos exactos para "${query}". Se muestran resultados similares.`,
          productos: result.products,
        };
        return JSON.stringify(payload);
      }

      return JSON.stringify(result.products);
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

  constructor(
    @Inject(COMMERCE_CONNECTOR_TOKEN)
    private readonly commerce: ICommerceConnector,
  ) {
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
    const productId = Number(args.producto_id);

    if (!tenantId) return 'Error: falta tenant_id.';
    if (isNaN(productId)) return 'Error: producto_id inválido.';

    try {
      const stockInfo = await this.commerce.getProductStock(tenantId, productId);
      return JSON.stringify(stockInfo);
    } catch (error) {
      this.logger.error(
        `Error en la herramienta ver_stock: ${(error as Error).message}`,
      );
      return `Error al consultar stock: ${(error as Error).message}`;
    }
  }
}

// ─── Tool: ver_estado_pedido ────────────────────────────────

@Injectable()
export class VerEstadoPedidoTool extends BaseTool {
  private readonly logger = new Logger(VerEstadoPedidoTool.name);
  readonly name = 'ver_estado_pedido';
  readonly inputSchema = verEstadoPedidoSchema;

  constructor(
    @Inject(COMMERCE_CONNECTOR_TOKEN)
    private readonly commerce: ICommerceConnector,
  ) {
    super();
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Obtiene el estado, detalles y resumen de un pedido de WooCommerce por su ID. ' +
        'Por seguridad, exige que el usuario proporcione el correo electrónico con el que facturó ' +
        'y el ID de su pedido.',
      parameters: {
        type: 'object',
        properties: {
          pedido_id: {
            type: ['integer', 'string'],
            description: 'El ID numérico de la orden o pedido (ej: 1422).',
          },
          email: {
            type: 'string',
            description:
              'El correo electrónico asociado al pedido para validación de identidad.',
          },
        },
        required: ['pedido_id', 'email'],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const tenantId = String(args.tenant_id || '');
    const orderId = Number(args.pedido_id);
    const email = String(args.email || '')
      .trim()
      .toLowerCase();

    if (!tenantId) return 'Error: falta tenant_id.';
    if (isNaN(orderId)) return 'Error: pedido_id inválido.';
    if (!email)
      return 'Error: el correo electrónico es obligatorio para validación de seguridad.';

    try {
      const orderResult = await this.commerce.getOrderState(tenantId, orderId, email);
      if (typeof orderResult === 'string') {
        return orderResult;
      }
      return JSON.stringify(orderResult);
    } catch (error) {
      this.logger.error(
        `Error en la herramienta ver_estado_pedido: ${(error as Error).message}`,
      );
      return `Error al consultar pedido: ${(error as Error).message}`;
    }
  }
}

// ─── Tool: obtener_categorias ──────────────────────────────

@Injectable()
export class ObtenerCategoriasTool extends BaseTool {
  private readonly logger = new Logger(ObtenerCategoriasTool.name);
  readonly name = 'obtener_categorias';
  readonly inputSchema = obtenerCategoriasSchema;

  constructor(
    @Inject(COMMERCE_CONNECTOR_TOKEN)
    private readonly commerce: ICommerceConnector,
  ) {
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
      const categories = await this.commerce.getCategories(tenantId);
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
    const productId = Number(args.producto_id);
    const quantity = Math.max(Number(args.cantidad) || 1, 1);

    if (isNaN(productId)) {
      return 'Error: El ID del producto no es válido.';
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
