import { Logger } from '@nestjs/common';
import {
  ICommerceConnector,
  ProductDto,
  CategoryDto,
  OrderDto,
} from '../commerce.interfaces.js';

/**
 * Credenciales para conexión a Odoo via JSON-RPC.
 * Se guardan cifradas en `ConnectorConfig.credentialsJson`.
 *
 * Odoo soporta dos protocolos: XML-RPC y JSON-RPC.
 * Usamos JSON-RPC porque no requiere paquetes externos (solo fetch nativo)
 * y es compatible con TODAS las versiones de Odoo (12, 13, 14, 15, 16, 17, 18+).
 *
 * Autenticación:
 * - Odoo 13 y anteriores: se usa el password del usuario.
 * - Odoo 14+: se puede usar API Key (reemplaza el password en la llamada RPC,
 *   el username sigue siendo el mismo).
 */
interface OdooCredentials {
  url: string;          // URL de Odoo (ej: https://mi-empresa.odoo.com)
  database: string;     // Nombre de la BD de Odoo
  username: string;      // Usuario (ej: admin)
  password: string;     // Password o API Key (Odoo 14+)
  currency?: string;    // Símbolo de moneda (default: $)
}

/**
 * Conector para Odoo via JSON-RPC.
 *
 * Implementa la misma interfaz `ICommerceConnector` que los demás conectores,
 * por lo que las tools del chatbot funcionan sin modificaciones.
 *
 * Modelos de Odoo utilizados:
 * - product.template  → productos (catálogo)
 * - product.category  → categorías
 * - product.product   → variantes (para stock detallado)
 * - sale.order        → pedidos
 * - sale.order.line   → líneas de pedido
 *
 * Compatibilidad: Odoo 12, 13, 14, 15, 16, 17, 18+
 * La API JSON-RPC de Odoo ha sido estable desde Odoo 8.
 */
export class OdooConnector implements ICommerceConnector {
  readonly connectorName = 'Odoo';
  private readonly logger = new Logger(OdooConnector.name);
  private readonly creds: OdooCredentials;
  private readonly currency: string;

  private uid: number | null = null;
  private requestId = 0;
  private availableProductFields: string[] | null = null;

  constructor(credentials: OdooCredentials) {
    this.creds = credentials;
    this.currency = credentials.currency || '$';
  }

  /**
   * Obtiene dinámicamente los campos disponibles en el modelo product.template,
   * verificando si la instancia del cliente tiene disponible el campo website_url.
   */
  private async getProductFields(): Promise<string[]> {
    if (this.availableProductFields !== null) {
      return this.availableProductFields;
    }

    const baseFields = [
      'id', 'name', 'display_name',
      'list_price',          // precio de venta
      'default_code',        // SKU / referencia interna
      'barcode',
      'description_sale',    // descripción de venta
      'categ_id',            // categoría [id, name]
      'qty_available',        // stock disponible
      'virtual_available',   // stock forecastado
      'type',                // consu, service, storable
    ];

    try {
      // Preguntamos a Odoo si existe el campo website_url en product.template
      const fieldsInfo = await this.executeKw<Record<string, any>>(
        'product.template',
        'fields_get',
        [[], ['website_url']],
      );
      if (fieldsInfo && fieldsInfo.website_url) {
        baseFields.push('website_url');
        this.logger.debug('Campo "website_url" disponible y activado en Odoo.');
      } else {
        this.logger.debug('Campo "website_url" no disponible en Odoo (módulo Website no instalado).');
      }
    } catch (e) {
      this.logger.warn(
        `No se pudo verificar disponibilidad de website_url en Odoo: ${(e as Error).message}. Se ignorará el campo.`
      );
    }

    this.availableProductFields = baseFields;
    return this.availableProductFields;
  }

  // ─── JSON-RPC de bajo nivel ─────────────────────────────────────────────

  /**
   * Llamada JSON-RPC genérica al endpoint /jsonrpc de Odoo.
   *
   * Odoo expone dos "servicios":
   * - "common": version, authenticate (no requieren auth previa)
   * - "object": execute_kw (requiere uid de authenticate)
   */
  private async rpc(service: string, method: string, args: any[]): Promise<any> {
    const body = {
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: ++this.requestId,
    };

    const endpoint = `${this.creds.url.replace(/\/$/, '')}/jsonrpc`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Odoo HTTP ${response.status}: ${response.statusText}`);
    }

    const json = await response.json();

    // Odoo devuelve errores dentro de json.error
    if (json.error) {
      const errMsg =
        json.error.data?.message ||
        json.error.message ||
        'Error desconocido de Odoo';
      this.logger.error(`Odoo RPC error: ${errMsg}`);
      throw new Error(`Odoo: ${errMsg}`);
    }

    return json.result;
  }

  /**
   * Autentica contra Odoo y guarda el uid para llamadas posteriores.
   * Se hace de forma perezosa en la primera llamada.
   */
  private async authenticate(): Promise<number> {
    if (this.uid !== null) return this.uid;

    const result = await this.rpc('common', 'authenticate', [
      this.creds.database,
      this.creds.username,
      this.creds.password,
      {}, // user agent info (vacío es válido)
    ]);

    if (!result) {
      throw new Error(
        `Autenticación Odoo fallida: credenciales inválidas para "${this.creds.username}" en BD "${this.creds.database}"`,
      );
    }

    this.uid = result as number;
    this.logger.log(
      `Autenticado en Odoo: ${this.creds.url} / ${this.creds.database} (uid: ${this.uid})`,
    );
    return this.uid;
  }

  /**
   * Ejecuta un método de un modelo de Odoo via execute_kw.
   *
   * @param model   Nombre del modelo (ej: 'product.template')
   * @param method  Método del ORM (ej: 'search_read', 'read')
   * @param args    Parámetros posicionales
   * @param kwargs  Parámetros opcionales (limit, fields, order, etc.)
   */
  private async executeKw<T = any>(
    model: string,
    method: string,
    args: any[],
    kwargs?: Record<string, any>,
  ): Promise<T> {
    const uid = await this.authenticate();
    return this.rpc('object', 'execute_kw', [
      this.creds.database,
      uid,
      this.creds.password,
      model,
      method,
      args,
      kwargs || {},
    ]);
  }

  // ─── ICommerceConnector ────────────────────────────────────────────────

  async buscarProductos(
    query: string,
    opciones: { limite?: number; categoria?: string } = {},
  ): Promise<ProductDto[]> {
    const limite = Math.min(opciones.limite || 5, 10);

    // Construir el dominio de búsqueda de Odoo
    const domain: any[] = [
      ['sale_ok', '=', true],   // disponible para venta
      ['active', '=', true],     // no archivado
    ];

    if (query && query.trim()) {
      // Buscar por nombre O código de producto O código de barras
      domain.push('|', '|',
        ['name', 'ilike', query.trim()],
        ['default_code', 'ilike', query.trim()],
        ['barcode', 'ilike', query.trim()],
      );
    }

    if (opciones.categoria) {
      const catId = await this.resolveCategoryId(opciones.categoria);
      if (catId) {
        domain.push(['categ_id', 'child_of', catId]);
      }
    }

    const fieldsToRead = await this.getProductFields();

    const products = await this.executeKw<any[]>(
      'product.template',
      'search_read',
      [domain],
      {
        fields: fieldsToRead,
        limit: limite,
        order: 'name ASC',
      },
    );

    return products.map((p) => this.toProductDto(p));
  }

  async obtenerCategorias(): Promise<CategoryDto[]> {
    const categories = await this.executeKw<any[]>(
      'product.category',
      'search_read',
      [[]], // dominio vacío = todas
      {
        fields: ['id', 'name', 'display_name', 'parent_id'],
        order: 'parent_id, name',
      },
    );

    // Contar productos por categoría
    return Promise.all(
      categories.map(async (cat) => {
        let count = 0;
        try {
          count = await this.executeKw<number>(
            'product.template',
            'search_count',
            [[['categ_id', 'child_of', cat.id], ['sale_ok', '=', true]]],
          );
        } catch {
          // Si falla el conteo, devolver 0
        }

        return {
          id: String(cat.id),
          nombre: cat.display_name || cat.name,
          cantidad: count,
        } as CategoryDto;
      }),
    );
  }

  async verStock(
    productoId: string,
  ): Promise<Pick<ProductDto, 'id' | 'nombre' | 'disponible' | 'stock'>> {
    const id = parseInt(productoId, 10);
    if (isNaN(id)) {
      throw new Error(`ID de producto Odoo inválido: "${productoId}"`);
    }

    const products = await this.executeKw<any[]>(
      'product.template',
      'read',
      [[id]],
      { fields: ['id', 'name', 'qty_available', 'virtual_available', 'type'] },
    );

    if (products.length === 0) {
      throw new Error(`Producto con ID "${productoId}" no encontrado en Odoo.`);
    }

    const p = products[0];
    const stock = Number(p.qty_available) || 0;

    // Si es un producto de tipo 'service', siempre está "disponible"
    const isService = p.type === 'service';
    const disponible = isService || stock > 0;

    return {
      id: String(p.id),
      nombre: p.name,
      disponible,
      stock: isService ? null : stock,
    };
  }

  async verEstadoPedido(pedidoId: string): Promise<OrderDto> {
    const id = parseInt(pedidoId, 10);
    if (isNaN(id)) {
      // También buscar por nombre de pedido (ej: "S00042")
      return this.findOrderByName(pedidoId);
    }

    return this.getOrderById(id);
  }

  async healthCheck(): Promise<boolean> {
    try {
      // version() no requiere autenticación
      await this.rpc('common', 'version', []);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /**
   * Resuelve un valor de categoría (ID numérico o nombre) al ID de Odoo.
   */
  private async resolveCategoryId(catValue: string): Promise<number | null> {
    const trimmed = catValue.trim();
    if (!trimmed) return null;

    // Si es numérico, devolver directo
    if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);

    // Buscar por nombre
    const categories = await this.executeKw<any[]>(
      'product.category',
      'search_read',
      [[['name', 'ilike', trimmed]]],
      { fields: ['id', 'name'], limit: 1 },
    );

    if (categories.length > 0) {
      const id = categories[0].id;
      this.logger.debug(`Categoría "${trimmed}" resuelta a ID: ${id}`);
      return id;
    }

    this.logger.warn(`No se encontró categoría para el nombre "${trimmed}".`);
    return null;
  }

  /**
   * Obtiene un pedido por ID numérico.
   */
  private async getOrderById(id: number): Promise<OrderDto> {
    const orders = await this.executeKw<any[]>(
      'sale.order',
      'read',
      [[id]],
      {
        fields: [
          'id', 'name', 'state', 'date_order',
          'amount_total', 'currency_id', 'order_line',
          'partner_id',
        ],
      },
    );

    if (orders.length === 0) {
      throw new Error(`Pedido con ID "${id}" no encontrado en Odoo.`);
    }

    return this.buildOrderDto(orders[0]);
  }

  /**
   * Busca un pedido por nombre (referencia, ej: "S00042").
   */
  private async findOrderByName(name: string): Promise<OrderDto> {
    const orders = await this.executeKw<any[]>(
      'sale.order',
      'search_read',
      [[['name', '=', name.trim()]]],
      {
        fields: [
          'id', 'name', 'state', 'date_order',
          'amount_total', 'currency_id', 'order_line',
        ],
        limit: 1,
      },
    );

    if (orders.length === 0) {
      throw new Error(`Pedido con referencia "${name}" no encontrado en Odoo.`);
    }

    return this.buildOrderDto(orders[0]);
  }

  /**
   * Construye un OrderDto a partir de un registro de sale.order de Odoo.
   * Lee las líneas del pedido (sale.order.line) para obtener los items.
   */
  private async buildOrderDto(order: any): Promise<OrderDto> {
    // Mapear el estado de Odoo a texto legible
    const stateMap: Record<string, string> = {
      draft: 'Borrador',
      sent: 'Enviado',
      sale: 'Confirmado',
      done: 'Completado',
      cancel: 'Cancelado',
    };

    // Leer las líneas del pedido
    let items: Array<{ nombre: string; cantidad: number; precio: string }> = [];

    if (order.order_line && order.order_line.length > 0) {
      const lines = await this.executeKw<any[]>(
        'sale.order.line',
        'read',
        [order.order_line],
        {
          fields: ['name', 'product_uom_qty', 'price_unit', 'price_subtotal'],
        },
      );

      items = lines.map((line) => ({
        nombre: String(line.name || ''),
        cantidad: Number(line.product_uom_qty) || 0,
        precio: `${this.currency}${Number(line.price_unit || 0).toFixed(2)}`,
      }));
    }

    const currencySymbol = order.currency_id?.[1]?.match(/\(([^)]+)\)/)?.[1] || this.currency;

    return {
      id: String(order.id),
      estado: stateMap[order.state] || order.state || '',
      total: `${currencySymbol}${Number(order.amount_total || 0).toFixed(2)}`,
      fecha: String(order.date_order || ''),
      items,
    };
  }

  /**
   * Mapea un producto de Odoo (product.template) a ProductDto.
   */
  private toProductDto(p: any): ProductDto {
    const stock = Number(p.qty_available) || 0;
    const isService = p.type === 'service';
    const disponible = isService || stock > 0;

    // categ_id viene como [id, name] (Many2one)
    const categorias: string[] = [];
    if (p.categ_id) {
      categorias.push(Array.isArray(p.categ_id) ? p.categ_id[1] : String(p.categ_id));
    }

    // Imagen: en vez de descargar y enviar el binario base64 pesado,
    // construimos la URL pública nativa de Odoo para obtener la imagen directamente.
    const imagen = `${this.creds.url.replace(/\/$/, '')}/web/image/product.template/${p.id}/image_128`;

    // URL del producto en el sitio web (si el módulo website está instalado)
    let url: string | null = null;
    if (p.website_url) {
      url = `${this.creds.url.replace(/\/$/, '')}${p.website_url}`;
    }

    return {
      id: String(p.id),
      nombre: p.display_name || p.name,
      precio: `${this.currency}${Number(p.list_price || 0).toFixed(2)}`,
      disponible,
      stock: isService ? null : stock,
      categorias,
      imagen,
      url,
      sku: p.default_code || null,
      descripcion: p.description_sale || null,
    };
  }
}
