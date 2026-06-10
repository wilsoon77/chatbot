import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ToolDefinition } from '../../llm/llm.interfaces.js';
import { BaseTool } from '../base.tool.js';
import { PrismaService } from '../../prisma/prisma.service.js';

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
   */
  private async getTenantConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
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

    return tenant;
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

// ────────────────────────────────────────────────────────────

interface WooProduct {
  id: number;
  name: string;
  slug: string;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  stock_status: string;
  stock_quantity: number | null;
  short_description: string;
  categories: Array<{ id: number; name: string }>;
  images: Array<{ src: string }>;
  permalink: string;
}

interface WooOrder {
  id: number;
  status: string;
  total: string;
  payment_method_title: string;
  date_created: string;
  billing: {
    email: string;
  };
  line_items: Array<{
    name: string;
    quantity: number;
    total: string;
  }>;
}

interface WooCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
}

@Injectable()
export class BuscarProductosTool extends BaseTool {
  private readonly logger = new Logger(BuscarProductosTool.name);
  readonly name = 'buscar_productos';

  constructor(private readonly wooClient: WooCommerceClient) {
    super();
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Busca productos en la tienda WooCommerce por nombre o palabra clave. ' +
        'Usa siempre el parámetro "query" con las palabras exactas que mencionó el usuario. ' +
        'NO uses el parámetro "categoria" a menos que el usuario haya indicado explícitamente ' +
        'una categoría Y conozcas su ID numérico real en WooCommerce. ' +
        'En caso de duda, omite "categoria" por completo — la búsqueda por "query" es suficiente.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Término de búsqueda en su forma base y en SINGULAR (ej: buscar "teclado" en lugar de "teclados", "flor" en lugar de "flores"). ' +
              'Normaliza a la palabra raíz en singular y evita plurales, artículos o marcas secundarias a menos que sean explícitas.',
          },
          categoria: {
            type: 'string',
            description:
              'ID numérico de la categoría en WooCommerce (ej: "17", "42"). ' +
              'SOLO usar si el usuario especificó una categoría exacta Y tienes su ID numérico real. ' +
              'NO inventar nombres de categorías ni convertirlos a slugs.',
          },
          limite: {
            type: 'string',
            description: 'Cantidad máxima de resultados a retornar (por defecto "5", máximo "10").',
          },
        },
        required: ['query'],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const tenantId = String(args.tenant_id || '');
    this.logger.log(`Tenant recibido para WooCommerce: ${tenantId}`);

    const query = String(args.query || '').trim();
    const limite = Math.min(Number(args.limite) || 5, 10);

    if (!tenantId) {
      return 'Error: falta tenant_id.';
    }

    // Si la búsqueda viene de la API, pedimos un volumen ligeramente mayor (x3)
    // para poder realizar el filtro inteligente localmente y aún así retornar suficientes resultados
    const requestLimit = query.length <= 4 ? limite * 3 : limite;

    const params: Record<string, string> = {
      search: query,
      per_page: String(requestLimit),
      status: 'publish',
    };

    if (args.categoria) {
      const cat = String(args.categoria).trim();
      if (/^\d+$/.test(cat)) {
        params.category = cat;
        this.logger.debug(`Filtrando por categoría ID: ${cat}`);
      } else {
        this.logger.warn(
          `Categoría ignorada (no es ID numérico): "${cat}". Se buscará solo por query: "${query}".`,
        );
      }
    }

    try {
      let products = await this.wooClient.get<WooProduct[]>(
        tenantId,
        'products',
        params,
      );

      if (!products || products.length === 0) {
        return `No se encontraron productos para "${query}".`;
      }

      // Filtro de palabra completa inteligente (Word Boundary / Límites de palabra)
      // Evita falsos positivos como que "RAM" coincida con "programa" o "herramientas".
      if (query.length > 0) {
        // Escapar caracteres regex especiales en la query del usuario
        const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        // Regex de límites de palabras para la query, insensible a mayúsculas/minúsculas
        const wordReg = new RegExp(`\\b${escapedQuery}\\b`, 'i');

        const filtered = products.filter((p) => wordReg.test(p.name));
        
        // Si el filtro estricto por palabras completas nos deja resultados, lo usamos.
        // Si no queda nada (por ejemplo, porque es una palabra recortada), caemos al listado original
        // para no romper la experiencia en búsquedas incompletas.
        if (filtered.length > 0) {
          products = filtered.slice(0, limite);
        } else {
          products = products.slice(0, limite);
        }
      }

      const currency = this.wooClient.getCurrencySymbol();

      const formatted = products.map((p) => ({
        id: p.id,
        nombre: p.name,
        precio: p.on_sale
          ? `${currency}${p.sale_price} (antes ${currency}${p.regular_price})`
          : `${currency}${p.price}`,
        disponible: p.stock_status === 'instock',
        stock: p.stock_quantity,
        categorias: p.categories.map((c) => c.name).join(', '),
        imagen: p.images[0]?.src || null,
        url: p.permalink,
      }));

      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      this.logger.error(
        `Error en la herramienta buscar_productos: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return `Error al buscar productos: ${(error as Error).message}`;
    }
  }
}

// ─── Tool: ver_stock ────────────────────────────────────────

@Injectable()
export class VerStockTool extends BaseTool {
  private readonly logger = new Logger(VerStockTool.name);
  readonly name = 'ver_stock';

  constructor(private readonly wooClient: WooCommerceClient) {
    super();
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: 'Obtiene las existencias físicas e inventario disponible de un producto específico mediante su ID.',
      parameters: {
        type: 'object',
        properties: {
          producto_id: {
            type: 'number',
            description: 'El ID numérico del producto (ej: 42, 107). Extraído del producto retornado previamente.',
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
      const p = await this.wooClient.get<WooProduct>(tenantId, `products/${productId}`);
      
      const stockInfo = {
        id: p.id,
        nombre: p.name,
        disponible: p.stock_status === 'instock',
        stock: p.stock_quantity !== null ? p.stock_quantity : 'Ilimitado / Sin control detallado',
      };

      return JSON.stringify(stockInfo, null, 2);
    } catch (error) {
      this.logger.error(`Error en la herramienta ver_stock: ${(error as Error).message}`);
      return `Error al consultar stock: ${(error as Error).message}`;
    }
  }
}

// ─── Tool: ver_estado_pedido ────────────────────────────────

@Injectable()
export class VerEstadoPedidoTool extends BaseTool {
  private readonly logger = new Logger(VerEstadoPedidoTool.name);
  readonly name = 'ver_estado_pedido';

  constructor(private readonly wooClient: WooCommerceClient) {
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
            type: 'number',
            description: 'El ID numérico de la orden o pedido (ej: 1422).',
          },
          email: {
            type: 'string',
            description: 'El correo electrónico asociado al pedido para validación de identidad.',
          },
        },
        required: ['pedido_id', 'email'],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const tenantId = String(args.tenant_id || '');
    const orderId = Number(args.pedido_id);
    const email = String(args.email || '').trim().toLowerCase();

    if (!tenantId) return 'Error: falta tenant_id.';
    if (isNaN(orderId)) return 'Error: pedido_id inválido.';
    if (!email) return 'Error: el correo electrónico es obligatorio para validación de seguridad.';

    try {
      const order = await this.wooClient.get<WooOrder>(tenantId, `orders/${orderId}`);

      // Validación estricta de seguridad: El correo provisto debe coincidir con el del pedido
      const billingEmail = String(order.billing?.email || '').trim().toLowerCase();
      if (billingEmail !== email) {
        this.logger.warn(`Intento de acceso denegado a orden ${orderId}: correo "${email}" no coincide con "${billingEmail}"`);
        return 'Acceso denegado: El correo electrónico provisto no coincide con el correo de facturación de esta orden.';
      }

      const formattedOrder = {
        id: order.id,
        estado: order.status,
        total: `${this.wooClient.getCurrencySymbol()}${order.total}`,
        metodo_pago: order.payment_method_title,
        fecha: order.date_created,
        items: order.line_items.map((item) => ({
          producto: item.name,
          cantidad: item.quantity,
          total: `${this.wooClient.getCurrencySymbol()}${item.total}`,
        })),
      };

      return JSON.stringify(formattedOrder, null, 2);
    } catch (error) {
      this.logger.error(`Error en la herramienta ver_estado_pedido: ${(error as Error).message}`);
      return `Error al consultar pedido: ${(error as Error).message}`;
    }
  }
}

// ─── Tool: obtener_categorias ──────────────────────────────

@Injectable()
export class ObtenerCategoriasTool extends BaseTool {
  private readonly logger = new Logger(ObtenerCategoriasTool.name);
  readonly name = 'obtener_categorias';

  constructor(private readonly wooClient: WooCommerceClient) {
    super();
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: 'Obtiene las categorías de productos disponibles en la tienda con sus respectivos IDs numéricos y conteo de productos.',
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
      const categories = await this.wooClient.get<WooCategory[]>(tenantId, 'products/categories', {
        per_page: '100',
        hide_empty: 'true',
      });

      const formatted = categories.map((c) => ({
        id: c.id,
        nombre: c.name,
        slug: c.slug,
        total_productos: c.count,
      }));

      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      this.logger.error(`Error en la herramienta obtener_categorias: ${(error as Error).message}`);
      return `Error al obtener categorías: ${(error as Error).message}`;
    }
  }
}

// ─── Tool: agregar_al_carrito ───────────────────────────────

@Injectable()
export class AgregarAlCarritoTool extends BaseTool {
  readonly name = 'agregar_al_carrito';

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: 'Solicita agregar un producto al carrito de compras del usuario mediante su ID de producto.',
      parameters: {
        type: 'object',
        properties: {
          producto_id: {
            type: 'number',
            description: 'El ID numérico del producto a agregar.',
          },
          cantidad: {
            type: 'number',
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

    // Esta herramienta responde con una confirmación que el LLM transmitirá al usuario.
    // La acción real de inyectar en el carrito se interceptará en el flujo del ChatService
    // y se enviará en los metadatos HTTP para que el frontend (React) la ejecute en local.
    const resultPayload = {
      status: 'pending_client_action',
      producto_id: productId,
      cantidad: quantity,
      mensaje: `Solicitud procesada: se agregará el producto ID ${productId} (cantidad: ${quantity}) al carrito del cliente.`,
    };

    return JSON.stringify(resultPayload, null, 2);
  }
}