import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../common/crypto/crypto.service.js'; // 👈 agregado
import type { ToolDefinition } from '../../llm/llm.interfaces.js';
import { BaseTool } from '../base.tool.js';
import { PrismaService } from '../../prisma/prisma.service.js';
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
  description: string;
  sku: string;
  categories: Array<{ id: number; name: string }>;
  tags: Array<{ id: number; name: string }>;
  images: Array<{ src: string }>;
  permalink: string;
}

/**
 * Construye un blob de texto "buscable" a partir de un producto, combinando
 * todos los campos relevantes que WooCommerce indexa: nombre, descripción,
 * descripción corta, SKU, categorías y tags. Se normaliza a minúsculas y se
 * elimina el HTML para que el post-filter por tokens pueda comparar contra
 * el contenido real, no solo contra el título.
 *
 * Esto resuelve el caso en que el usuario busca "teclado RGB" y el producto
 * se llama "Teclado mecánico" pero su DESCRIPCIÓN dice "con iluminación RGB":
 * antes el post-filter solo revisaba el nombre y lo descartaba como no-match.
 */
function buildSearchableText(p: WooProduct): string {
  const stripHtml = (html: string) =>
    html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ');
  const parts = [
    p.name,
    p.short_description,
    p.description,
    p.sku,
    (p.categories || []).map((c) => c.name).join(' '),
    (p.tags || []).map((t) => t.name).join(' '),
  ];
  return stripHtml(parts.join(' ')).toLowerCase();
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
  readonly inputSchema = buscarProductosSchema;

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
        'En caso de duda, omite "categoria" por completo — la búsqueda por "query" es suficiente. ' +
        'IMPORTANTE: NO llames esta herramienta si el usuario solo saluda, agradece, se despide o ' +
        'pregunta "¿qué venden?"/"¿qué tienen?" (en ese caso usa `obtener_categorias`). ' +
        'Solo úsala cuando el usuario mencione explícitamente un producto o tipo de producto a buscar. ' +
        'NUNCA pidas datos adicionales (marca, modelo, precio) antes de buscar: busca primero con lo que ' +
        'el usuario dio. La búsqueda se amplía automáticamente: si no hay resultados para el query ' +
        'completo, reintenta con un término más base. Si aun así no hay, devuelve un objeto con ' +
        'status "no_results" — en ese caso NO insistas: informa al usuario y ofrece alternativas ' +
        'reales (otra búsqueda o categorías).',
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
            type: ['integer', 'string'],
            description:
              'Cantidad máxima de resultados a retornar (por defecto 5, máximo 10). DEBE ser un número entero.',
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
      return JSON.stringify({ status: 'error', mensaje: 'Falta tenant_id.' });
    }

    const buildParams = (searchTerm: string): Record<string, string> => {
      const p: Record<string, string> = {
        search: searchTerm,
        per_page: String(searchTerm.length <= 4 ? limite * 3 : limite),
        status: 'publish',
      };
      if (args.categoria) {
        const cat = String(args.categoria).trim();
        if (/^\d+$/.test(cat)) {
          p.category = cat;
          this.logger.debug(`Filtrando por categoría ID: ${cat}`);
        } else {
          this.logger.warn(
            `Categoría ignorada (no es ID numérico): "${cat}". Se buscará solo por query: "${searchTerm}".`,
          );
        }
      }
      return p;
    };

    // Busca un término en WooCommerce y aplica el post-filter por tokens.
    // Devuelve { products, usedFallback } o null si Woo no trajo nada.
    const searchWoo = async (
      searchTerm: string,
    ): Promise<{ products: WooProduct[]; usedFallback: boolean } | null> => {
      const products = await this.wooClient.get<WooProduct[]>(
        tenantId,
        'products',
        buildParams(searchTerm),
      );
      if (!products || products.length === 0) {
        return null;
      }

      if (searchTerm.length > 0) {
        // Post-filter tolerante a multi-palabra: el query se parte en tokens y
        // se exige que TODAS las palabras estén presentes en el contenido
        // completo del producto (nombre + descripción + descripción corta +
        // SKU + categorías + tags), no necesariamente contiguas ni en el mismo
        // campo. Así "teclado RGB" matchea un producto cuyo NOMBRE es
        // "Teclado mecánico" pero cuya DESCRIPCIÓN dice "con iluminación RGB".
        const tokens = searchTerm
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 0);
        const matchesAllTokens = (p: WooProduct) => {
          const haystack = buildSearchableText(p);
          return tokens.every((tok) => haystack.includes(tok));
        };

        const filtered = products.filter((p) => matchesAllTokens(p));
        if (filtered.length > 0) {
          return { products: filtered.slice(0, limite), usedFallback: false };
        }
        // Sin coincidencia en ningún campo: devolvemos el top-N que entregó
        // WooCommerce (su motor de búsqueda ya pondera por relevancia).
        this.logger.warn(
          `Ningún producto contiene todos los tokens de "${searchTerm}" en ` +
            `nombre/descripción/tags. Devolviendo top-${limite} de WooCommerce como fallback.`,
        );
        return { products: products.slice(0, limite), usedFallback: true };
      }
      return { products: products.slice(0, limite), usedFallback: false };
    };

    try {
      // ── Fase 1: búsqueda con el query tal cual lo dio el usuario ──
      let result = await searchWoo(query);

      // ── Fase 2: si no hay resultados y el query es multi-palabra,
      //    reintenta con el término base (primera palabra). ──
      let queryAmpliado: string | null = null;
      if (!result && query.includes(' ')) {
        queryAmpliado = query.split(/\s+/)[0];
        this.logger.debug(
          `Sin resultados para "${query}". Reintentando con término base "${queryAmpliado}".`,
        );
        result = await searchWoo(queryAmpliado);
      }

      // ── Fase 3: si tras el reintento sigue sin resultados,
      //    señal estructurada no_results para que el LLM ofrezca alternativas. ──
      if (!result) {
        const payload = {
          status: 'no_results' as const,
          query,
          query_ampliado: queryAmpliado,
          sugerencia:
            `No se encontraron productos que coincidan con "${query}"` +
            (queryAmpliado ? ` (ni con "${queryAmpliado}")` : '') +
            '. Ofrece alternativas reales: sugiere buscar otro término, muestra ' +
            'categorías disponibles con obtener_categorias, o pregunta por un ' +
            'tipo de producto similar. NO inventes productos.',
        };
        return JSON.stringify(payload, null, 2);
      }

      const currency = this.wooClient.getCurrencySymbol();

      const formatted = result.products.map((p) => ({
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

      const isPartialMatch = queryAmpliado !== null || result.usedFallback;

      if (isPartialMatch) {
        const payload = {
          status: 'partial_match' as const,
          query_original: query,
          query_usado: queryAmpliado || query,
          nota: queryAmpliado
            ? `No se encontraron productos para "${query}". Se muestran resultados similares para "${queryAmpliado}".`
            : `No se encontraron productos que coincidan exactamente con todas las palabras de "${query}". Se muestran los resultados más relevantes del motor de búsqueda.`,
          productos: formatted,
        };
        return JSON.stringify(payload, null, 2);
      }

      return JSON.stringify(formatted, null, 2);
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

  constructor(private readonly wooClient: WooCommerceClient) {
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
      const p = await this.wooClient.get<WooProduct>(
        tenantId,
        `products/${productId}`,
      );

      const stockInfo = {
        id: p.id,
        nombre: p.name,
        disponible: p.stock_status === 'instock',
        stock:
          p.stock_quantity !== null
            ? p.stock_quantity
            : 'Ilimitado / Sin control detallado',
      };

      return JSON.stringify(stockInfo, null, 2);
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
      const order = await this.wooClient.get<WooOrder>(
        tenantId,
        `orders/${orderId}`,
      );

      const billingEmail = String(order.billing?.email || '')
        .trim()
        .toLowerCase();
      if (billingEmail !== email) {
        this.logger.warn(
          `Intento de acceso denegado a orden ${orderId}: correo "${email}" no coincide con "${billingEmail}"`,
        );
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

  constructor(private readonly wooClient: WooCommerceClient) {
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
      const categories = await this.wooClient.get<WooCategory[]>(
        tenantId,
        'products/categories',
        {
          per_page: '100',
          hide_empty: 'true',
        },
      );

      const formatted = categories.map((c) => ({
        id: c.id,
        nombre: c.name,
        slug: c.slug,
        total_productos: c.count,
      }));

      return JSON.stringify(formatted, null, 2);
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

    return JSON.stringify(resultPayload, null, 2);
  }
}
