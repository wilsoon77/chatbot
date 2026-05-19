import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ToolDefinition } from '../../llm/llm.interfaces.js';
import { BaseTool } from '../base.tool.js';

/**
 * Cliente HTTP para la API REST de WooCommerce.
 * Maneja autenticación con Consumer Key / Secret.
 */
@Injectable()
export class WooCommerceClient {
  private readonly logger = new Logger(WooCommerceClient.name);
  private readonly baseUrl: string;
  private readonly consumerKey: string;
  private readonly consumerSecret: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('WOO_BASE_URL') || '';
    this.consumerKey = this.config.get<string>('WOO_CONSUMER_KEY') || '';
    this.consumerSecret = this.config.get<string>('WOO_CONSUMER_SECRET') || '';

    if (!this.baseUrl || !this.consumerKey || !this.consumerSecret) {
      this.logger.warn(
        'Credenciales de WooCommerce no configuradas. Las tools de WooCommerce no funcionarán.',
      );
    }
  }

  /**
   * Realiza una petición GET a la API de WooCommerce.
   */
  async get<T = unknown>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`/wp-json/wc/v3/${endpoint}`, this.baseUrl);

    // Auth por query params (Consumer Key/Secret)
    url.searchParams.set('consumer_key', this.consumerKey);
    url.searchParams.set('consumer_secret', this.consumerSecret);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    this.logger.debug(`WooCommerce GET: ${url.pathname}${url.search}`);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WooCommerce API error (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }
}

// ─── Tool: buscar_productos ─────────────────────────────────

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

@Injectable()
export class BuscarProductosTool extends BaseTool {
  readonly name = 'buscar_productos';

  constructor(private readonly wooClient: WooCommerceClient) {
    super();
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description:
        'Busca productos en la tienda WooCommerce por nombre, palabra clave o categoría. Devuelve una lista de productos con nombre, precio, disponibilidad e imagen.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Término de búsqueda (nombre del producto, palabra clave, etc.)',
          },
          categoria: {
            type: 'string',
            description: 'Filtrar por nombre de categoría (opcional)',
          },
          limite: {
            type: 'number',
            description: 'Cantidad máxima de resultados (por defecto 5, máximo 10)',
          },
        },
        required: ['query'],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query || '');
    const limite = Math.min(Number(args.limite) || 5, 10);

    const params: Record<string, string> = {
      search: query,
      per_page: String(limite),
      status: 'publish',
    };

    // Si se pasa categoría, buscar el ID primero
    if (args.categoria) {
      const catSlug = String(args.categoria).toLowerCase().replace(/\s+/g, '-');
      params.category = catSlug;
    }

    try {
      const products = await this.wooClient.get<WooProduct[]>('products', params);

      if (!products || products.length === 0) {
        return `No se encontraron productos para "${query}".`;
      }

      const formatted = products.map((p) => ({
        id: p.id,
        nombre: p.name,
        precio: p.on_sale ? `${p.sale_price} (antes ${p.regular_price})` : p.price,
        disponible: p.stock_status === 'instock',
        stock: p.stock_quantity,
        categorias: p.categories.map((c) => c.name).join(', '),
        imagen: p.images[0]?.src || null,
        url: p.permalink,
      }));

      return JSON.stringify(formatted, null, 2);
    } catch (error) {
      return `Error al buscar productos: ${(error as Error).message}`;
    }
  }
}
