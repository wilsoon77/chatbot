import { Injectable, Logger } from '@nestjs/common';
import { WooCommerceClient } from '../../tools/woocommerce/woocommerce.tool.js';
import type {
  ICommerceConnector,
  ProductDto,
  OrderDto,
  CategoryDto,
} from '../commerce.interfaces.js';

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

function removeDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function levenshtein(a: string, b: string): number {
  const tmp: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    tmp[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    tmp[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        tmp[i][j] = tmp[i - 1][j - 1];
      } else {
        tmp[i][j] = Math.min(
          tmp[i - 1][j - 1] + 1, // sustitución
          Math.min(
            tmp[i][j - 1] + 1, // inserción
            tmp[i - 1][j] + 1  // eliminación
          )
        );
      }
    }
  }
  return tmp[b.length][a.length];
}

function isFuzzyMatch(token: string, haystackWords: string[]): boolean {
  if (haystackWords.some((w) => w.includes(token) || token.includes(w))) {
    return true;
  }
  for (const word of haystackWords) {
    const maxDistance = token.length <= 4 ? 1 : 2;
    if (Math.abs(word.length - token.length) <= maxDistance) {
      if (levenshtein(token, word) <= maxDistance) {
        return true;
      }
    }
  }
  return false;
}

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
  return removeDiacritics(stripHtml(parts.join(' ')).toLowerCase());
}

@Injectable()
export class WooCommerceConnector implements ICommerceConnector {
  private readonly logger = new Logger(WooCommerceConnector.name);

  constructor(private readonly wooClient: WooCommerceClient) {}

  async searchProducts(
    tenantId: string,
    query: string,
    categoryId?: string,
    limit?: number,
  ): Promise<{ products: ProductDto[]; usedFallback: boolean } | null> {
    const limite = Math.min(limit || 5, 10);

    const buildParams = (searchTerm: string): Record<string, string> => {
      const p: Record<string, string> = {
        per_page: String(searchTerm.length > 0 && searchTerm.length <= 4 ? limite * 3 : limite),
        status: 'publish',
      };
      if (searchTerm) {
        p.search = searchTerm;
      }
      if (categoryId) {
        const cat = categoryId.trim();
        if (/^\d+$/.test(cat)) {
          p.category = cat;
          this.logger.debug(`Filtrando por categoría ID: ${cat}`);
        }
      }
      return p;
    };

    const searchWoo = async (
      searchTerm: string,
      filterQuery?: string,
    ): Promise<{ products: WooProduct[]; usedFallback: boolean } | null> => {
      const products = await this.wooClient.get<WooProduct[]>(
        tenantId,
        'products',
        buildParams(searchTerm),
      );
      if (!products || products.length === 0) {
        return null;
      }

      const activeFilterQuery = filterQuery !== undefined ? filterQuery : searchTerm;

      if (activeFilterQuery.length > 0) {
        const stopWords = ['con', 'de', 'para', 'y', 'o', 'un', 'una', 'el', 'la', 'los', 'las', 'del', 'al', 'en'];
        const tokens = removeDiacritics(activeFilterQuery.toLowerCase())
          .split(/\s+/)
          .filter((t) => t.length > 0 && !stopWords.includes(t));

        if (tokens.length === 0) {
          return { products: products.slice(0, limite), usedFallback: false };
        }

        const matchesAllTokens = (p: WooProduct) => {
          const haystack = buildSearchableText(p);
          const haystackWords = haystack.split(/\s+/);
          return tokens.every((tok) => isFuzzyMatch(tok, haystackWords));
        };

        const filtered = products.filter((p) => matchesAllTokens(p));
        if (filtered.length > 0) {
          return { products: filtered.slice(0, limite), usedFallback: false };
        }

        if (filterQuery !== undefined) {
          return null;
        }

        const matchesPartialTokens = (p: WooProduct) => {
          const haystack = buildSearchableText(p);
          const haystackWords = haystack.split(/\s+/);
          const matchedCount = tokens.filter((tok) => isFuzzyMatch(tok, haystackWords)).length;
          return matchedCount / tokens.length >= 0.5;
        };

        const partialFiltered = products.filter((p) => matchesPartialTokens(p));
        if (partialFiltered.length > 0) {
          this.logger.warn(
            `Filtro exacto fallido para "${activeFilterQuery}". Devolviendo coincidencias parciales.`
          );
          return { products: partialFiltered.slice(0, limite), usedFallback: true };
        }

        this.logger.warn(
          `Ningún producto superó el umbral del 50% de relevancia para "${activeFilterQuery}". Retornando null.`
        );
        return null;
      }
      return { products: products.slice(0, limite), usedFallback: false };
    };

    let result = await searchWoo(query);

    let queryAmpliado: string | null = null;
    if (!result && query.includes(' ')) {
      queryAmpliado = query.split(/\s+/)[0];
      this.logger.debug(
        `Sin resultados para "${query}". Reintentando con término base "${queryAmpliado}".`,
      );
      result = await searchWoo(queryAmpliado, query);
    }

    if (!result) return null;

    const currency = this.wooClient.getCurrencySymbol();
    const formatted: ProductDto[] = result.products.map((p) => ({
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

    return {
      products: formatted,
      usedFallback: queryAmpliado !== null || result.usedFallback,
    };
  }

  async getProductStock(
    tenantId: string,
    productId: number,
  ): Promise<{ id: number; nombre: string; disponible: boolean; stock: number | string }> {
    const p = await this.wooClient.get<WooProduct>(
      tenantId,
      `products/${productId}`,
    );

    return {
      id: p.id,
      nombre: p.name,
      disponible: p.stock_status === 'instock',
      stock:
        p.stock_quantity !== null
          ? p.stock_quantity
          : 'Ilimitado / Sin control detallado',
    };
  }

  async getOrderState(
    tenantId: string,
    orderId: number,
    email: string,
  ): Promise<OrderDto | string> {
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

    const currency = this.wooClient.getCurrencySymbol();
    return {
      id: order.id,
      estado: order.status,
      total: `${currency}${order.total}`,
      metodo_pago: order.payment_method_title,
      fecha: order.date_created,
      items: order.line_items.map((item) => ({
        producto: item.name,
        cantidad: item.quantity,
        total: `${currency}${item.total}`,
      })),
    };
  }

  async getCategories(tenantId: string): Promise<CategoryDto[]> {
    const categories = await this.wooClient.get<WooCategory[]>(
      tenantId,
      'products/categories',
      {
        per_page: '100',
        hide_empty: 'true',
      },
    );

    return categories.map((c) => ({
      id: c.id,
      nombre: c.name,
      slug: c.slug,
      total_productos: c.count,
    }));
  }
}
