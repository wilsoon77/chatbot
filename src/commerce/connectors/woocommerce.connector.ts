import { Logger } from '@nestjs/common';
import {
  ICommerceConnector,
  ProductDto,
  CategoryDto,
  OrderDto,
} from '../commerce.interfaces.js';

interface WooCredentials {
  url: string;            // URL de la tienda
  consumerKey: string;    // ck_...
  consumerSecret: string; // cs_...
  currency?: string;      // Símbolo de moneda (default: $)
}

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
    price: number | string;
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

function singularize(word: string): string {
  const w = word.trim().toLowerCase();
  // Evitar singularizar palabras muy cortas (ej: "es", "os", "as")
  if (w.length <= 3) return word;
  
  if (w.endsWith('es')) {
    // Ejemplo: monitores -> monitor, cables -> cable, celulares -> celular
    return word.slice(0, -2);
  }
  if (w.endsWith('s') && !w.endsWith('is') && !w.endsWith('as') && !w.endsWith('us')) {
    // Ejemplo: teclados -> teclado, mouses -> mouse
    return word.slice(0, -1);
  }
  return word;
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
            tmp[i - 1][j] + 1, // eliminación
          ),
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

export class WooCommerceConnector implements ICommerceConnector {
  readonly connectorName = 'WooCommerce';
  private readonly logger = new Logger(WooCommerceConnector.name);
  private readonly currency: string;
  private categoriesCache: WooCategory[] | null = null;

  constructor(private readonly creds: WooCredentials) {
    this.currency = creds.currency || '$';
  }

  /**
   * Resuelve un valor de categoría (que puede ser un ID numérico o un nombre)
   * al ID numérico que espera la API de WooCommerce.
   * Si es un nombre, consulta las categorías (con caché) y busca por coincidencia fuzzy.
   */
  private async resolveCategoryId(catValue: string): Promise<string | undefined> {
    const trimmed = catValue.trim();
    if (!trimmed) return undefined;

    // Si ya es numérico, devolver directamente
    if (/^\d+$/.test(trimmed)) return trimmed;

    // Es un nombre de categoría — resolver a ID
    this.logger.debug(`Categoría "${trimmed}" no es numérica. Intentando resolver por nombre...`);

    if (!this.categoriesCache) {
      try {
        this.categoriesCache = await this.get<WooCategory[]>('products/categories', {
          per_page: '100',
          hide_empty: 'true',
        });
      } catch (err) {
        this.logger.warn(`No se pudieron obtener categorías para resolver nombre: ${(err as Error).message}`);
        return undefined;
      }
    }

    const normalizedInput = removeDiacritics(trimmed.toLowerCase());

    // Búsqueda exacta primero
    const exact = this.categoriesCache.find(
      (c) => removeDiacritics(c.name.toLowerCase()) === normalizedInput,
    );
    if (exact) {
      this.logger.debug(`Categoría resuelta: "${trimmed}" → ID ${exact.id} ("${exact.name}")`);
      return String(exact.id);
    }

    // Búsqueda parcial (la entrada está contenida en el nombre o viceversa)
    const partial = this.categoriesCache.find((c) => {
      const norm = removeDiacritics(c.name.toLowerCase());
      return norm.includes(normalizedInput) || normalizedInput.includes(norm);
    });
    if (partial) {
      this.logger.debug(`Categoría resuelta (parcial): "${trimmed}" → ID ${partial.id} ("${partial.name}")`);
      return String(partial.id);
    }

    this.logger.warn(`No se encontró categoría para el nombre "${trimmed}".`);
    return undefined;
  }

  async buscarProductos(
    query: string,
    opciones: { limite?: number; categoria?: string } = {},
  ): Promise<ProductDto[]> {
    const limite = Math.min(opciones.limite || 5, 10);
    const queryStr = query.trim();

    // Resolver categoría (soporta tanto ID numérico como nombre)
    const resolvedCategory = opciones.categoria
      ? await this.resolveCategoryId(opciones.categoria)
      : undefined;

    const buildParams = (searchTerm: string): Record<string, string> => {
      const p: Record<string, string> = {
        per_page: String(searchTerm.length > 0 && searchTerm.length <= 4 ? limite * 3 : limite),
        status: 'publish',
      };
      if (searchTerm) {
        p.search = searchTerm;
      }
      if (resolvedCategory) {
        p.category = resolvedCategory;
        this.logger.debug(`Filtrando por categoría ID: ${resolvedCategory}`);
      }
      return p;
    };

    const searchWoo = async (
      searchTerm: string,
      filterQuery?: string,
    ): Promise<WooProduct[] | null> => {
      const products = await this.get<WooProduct[]>('products', buildParams(searchTerm));
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
          return products.slice(0, limite);
        }

        const matchesAllTokens = (p: WooProduct) => {
          const haystack = buildSearchableText(p);
          const haystackWords = haystack.split(/\s+/);
          return tokens.every((tok) => isFuzzyMatch(tok, haystackWords));
        };

        const filtered = products.filter((p) => matchesAllTokens(p));
        if (filtered.length > 0) {
          return filtered.slice(0, limite);
        }

        if (filterQuery !== undefined) {
          return null;
        }

        // Lógica de coincidencia parcial (50% de relevancia)
        const matchesPartialTokens = (p: WooProduct) => {
          const haystack = buildSearchableText(p);
          const haystackWords = haystack.split(/\s+/);
          const matchedCount = tokens.filter((tok) => isFuzzyMatch(tok, haystackWords)).length;
          return matchedCount / tokens.length >= 0.5;
        };

        const partialFiltered = products.filter((p) => matchesPartialTokens(p));
        if (partialFiltered.length > 0) {
          this.logger.warn(
            `Filtro exacto fallido para "${activeFilterQuery}". Devolviendo coincidencias parciales.`,
          );
          return partialFiltered.slice(0, limite);
        }

        this.logger.warn(
          `Ningún producto superó el umbral del 50% de relevancia para "${activeFilterQuery}". Retornando vacío.`,
        );
        return null;
      }

      return products.slice(0, limite);
    };

    let result = await searchWoo(queryStr);
    let queryAmpliado: string | null = null;

    // Fallback 1: Si no hay resultados y la palabra tiene terminación plural, intentamos singularizar
    if (!result && queryStr.length > 3) {
      const singular = singularize(queryStr);
      if (singular !== queryStr) {
        this.logger.debug(
          `Sin resultados para "${queryStr}". Reintentando en singular con "${singular}".`,
        );
        result = await searchWoo(singular, queryStr);
      }
    }

    // Fallback 2: Si aún no hay resultados y contiene múltiples palabras, reintentamos con la primera palabra
    if (!result && queryStr.includes(' ')) {
      queryAmpliado = queryStr.split(/\s+/)[0];
      this.logger.debug(
        `Sin resultados para "${queryStr}". Reintentando con término base "${queryAmpliado}".`,
      );
      result = await searchWoo(queryAmpliado, queryStr);
    }

    if (!result) return [];

    return result.map((p) => this.toCanonicalProduct(p));
  }

  async obtenerCategorias(): Promise<CategoryDto[]> {
    const raw = await this.get<WooCategory[]>('products/categories', {
      per_page: '100',
      hide_empty: 'true',
    });

    return raw.map((c) => ({
      id: String(c.id),
      nombre: c.name,
      cantidad: c.count,
    }));
  }

  async verStock(productoId: string): Promise<Pick<ProductDto, 'id' | 'nombre' | 'disponible' | 'stock'>> {
    const p = await this.get<WooProduct>(`products/${productoId}`);
    return {
      id: String(p.id),
      nombre: p.name,
      disponible: p.stock_status === 'instock',
      stock: p.stock_quantity ?? null,
    };
  }

  async verEstadoPedido(pedidoId: string): Promise<OrderDto> {
    const o = await this.get<WooOrder>(`orders/${pedidoId}`);
    return {
      id: String(o.id),
      estado: o.status,
      total: `${this.currency}${o.total}`,
      fecha: o.date_created,
      items: (o.line_items || []).map((i) => ({
        nombre: i.name,
        cantidad: i.quantity,
        precio: `${this.currency}${i.price || '0.00'}`,
      })),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.get('system_status');
      return true;
    } catch {
      return false;
    }
  }

  // ─── HTTP Helper ───────────────────────────────────────────

  private async get<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
    // Limpiar url base si tiene barras al final
    let baseUrl = this.creds.url.trim();
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.substring(0, baseUrl.length - 1);
    }

    const url = new URL(`${baseUrl}/wp-json/wc/v3/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    this.logger.debug(`WooCommerce GET: ${url.pathname}${url.search}`);

    // Cifrar credenciales en Base64 para Basic Auth
    const credentialsBase64 = Buffer.from(
      `${this.creds.consumerKey}:${this.creds.consumerSecret}`,
    ).toString('base64');

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${credentialsBase64}`,
        'Content-Type': 'application/json',
        'User-Agent': 'ChatbotWoo/2.0',
      },
    });

    if (!response.ok) {
      throw new Error(`WooCommerce API error ${response.status}: ${await response.text()}`);
    }

    return response.json() as Promise<T>;
  }

  private toCanonicalProduct(p: WooProduct): ProductDto {
    return {
      id: String(p.id),
      nombre: p.name,
      precio: p.on_sale
        ? `${this.currency}${p.sale_price} (antes ${this.currency}${p.regular_price})`
        : `${this.currency}${p.price}`,
      disponible: p.stock_status === 'instock',
      stock: p.stock_quantity ?? null,
      categorias: (p.categories || []).map((c) => c.name),
      imagen: p.images?.[0]?.src || null,
      url: p.permalink || null,
      sku: p.sku || null,
      descripcion: p.short_description
        ? p.short_description.replace(/<[^>]*>/g, '')
        : null,
    };
  }
}
