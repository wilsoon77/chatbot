import { Injectable, Logger } from '@nestjs/common';
import type { ToolDefinition } from '../../llm/llm.interfaces.js';
import { BaseTool } from '../base.tool.js';
import { PrismaService } from '../../prisma/prisma.service.js';

/**
 * Cliente HTTP para la API REST de WooCommerce.
 * Carga credenciales dinámicamente desde la tabla Tenant.
 */
@Injectable()
export class WooCommerceClient {
  private readonly logger = new Logger(WooCommerceClient.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getTenantConfig(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new Error(`No se encontró el tenant con id: ${tenantId}`);
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

  async get<T = unknown>(
    tenantId: string,
    endpoint: string,
    params: Record<string, string> = {},
  ): Promise<T> {
    const tenant = await this.getTenantConfig(tenantId);

    let base = tenant.woocommerceUrl;

    if (!base.endsWith('/')) {
      base += '/';
    }

    const url = new URL(`wp-json/wc/v3/${endpoint}`, base);

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
          `Inicio de la respuesta: ${text
            .substring(0, 300)
            .replace(/\s+/g, ' ')}...`,
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

@Injectable()
export class BuscarProductosTool extends BaseTool {
  private readonly logger = new Logger(BuscarProductosTool.name);

  readonly name = 'buscar_productos';

  constructor(private readonly wooClient: WooCommerceClient) {
    super();
  }

  // ── Fix 2: descripción más precisa para que el LLM no invente categorías ──
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
              'Palabras clave del producto tal como el usuario las mencionó. ' +
              'Ejemplo: "Monitor curvo 27 pulgadas", "silla de oficina", "teclado mecánico".',
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
            description: 'Máximo de resultados a retornar (por defecto 5, máximo 10).',
          },
        },

        required: ['query'],
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const tenantId = String(args.tenant_id || '');

    this.logger.log(`Tenant recibido para WooCommerce: ${tenantId}`);

    const query = String(args.query || '');
    const limite = Math.min(Number(args.limite) || 5, 10);

    if (!tenantId) {
      return 'Error: falta tenant_id.';
    }

    const params: Record<string, string> = {
      search: query,
      per_page: String(limite),
      status: 'publish',
    };

    // ── Fix 1: solo aceptar categoria si es un ID numérico real ──
    // Si el LLM envía un string libre ("Electrónica", "informatica", etc.)
    // se ignora completamente para evitar que WooCommerce devuelva vacío.
    if (args.categoria) {
      const cat = String(args.categoria).trim();

      if (/^\d+$/.test(cat)) {
        // Es un ID numérico válido → seguro usarlo
        params.category = cat;
        this.logger.debug(`Filtrando por categoría ID: ${cat}`);
      } else {
        // Es un slug o nombre inventado por el LLM → ignorar
        this.logger.warn(
          `Categoría ignorada (no es ID numérico): "${cat}". ` +
            `Se buscará solo por query: "${query}".`,
        );
      }
    }

    try {
      const products = await this.wooClient.get<WooProduct[]>(
        tenantId,
        'products',
        params,
      );

      if (!products || products.length === 0) {
        return `No se encontraron productos para "${query}".`;
      }

      const formatted = products.map((p) => ({
        id: p.id,
        nombre: p.name,
        precio: p.on_sale
          ? `${p.sale_price} (antes ${p.regular_price})`
          : p.price,
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