import { Logger } from '@nestjs/common';
import {
  ICommerceConnector,
  ProductDto,
  CategoryDto,
  OrderDto,
} from '../commerce.interfaces.js';

/**
 * Credenciales para conexión directa a la BD de una tienda externa.
 * Se guardan cifradas en `ConnectorConfig.credentialsJson`.
 */
interface DatabaseCredentials {
  driver: 'postgresql' | 'mysql';
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  currency?: string;
  /**
   * Mapeo de tablas y columnas de la tienda del cliente.
   * Permite que el conector funcione con cualquier schema de BD,
   * sin importar cómo llame la tienda a sus tablas.
   */
  tableMapping?: TableMapping;
}

interface TableMapping {
  products: string;
  categories: string;
  orders: string;
  orderItems: string;
  columns: {
    product: {
      id: string;
      name: string;
      price: string;
      stock: string;
      stockStatus?: string;
      sku?: string;
      description?: string;
      image?: string;
      url?: string;
      categoryId?: string;
    };
    category: {
      id: string;
      name: string;
      count?: string;
    };
    order: {
      id: string;
      status: string;
      total: string;
      date: string;
      email?: string;
    };
    orderItem: {
      orderId: string;
      productName: string;
      quantity: string;
      price: string;
    };
  };
}

/** Mapeo por defecto (asume nombres de tablas en inglés estándar). */
const DEFAULT_TABLE_MAPPING: TableMapping = {
  products: 'products',
  categories: 'categories',
  orders: 'orders',
  orderItems: 'order_items',
  columns: {
    product: {
      id: 'id',
      name: 'name',
      price: 'price',
      stock: 'stock_quantity',
      stockStatus: 'stock_status',
      sku: 'sku',
      description: 'description',
      image: 'image_url',
      url: 'url',
      categoryId: 'category_id',
    },
    category: {
      id: 'id',
      name: 'name',
      count: 'product_count',
    },
    order: {
      id: 'id',
      status: 'status',
      total: 'total',
      date: 'created_at',
      email: 'customer_email',
    },
    orderItem: {
      orderId: 'order_id',
      productName: 'product_name',
      quantity: 'quantity',
      price: 'price',
    },
  },
};

/**
 * Conector que se conecta directamente a la BD de una tienda externa
 * (PostgreSQL o MySQL/MariaDB) para leer productos, stock, categorías y pedidos.
 *
 * Implementa la misma interfaz `ICommerceConnector` que `WooCommerceConnector`,
 * por lo que las tools del chatbot funcionan sin modificaciones.
 *
 * A diferencia del conector de WooCommerce (que usa la API REST), este conector
 * ejecuta queries SQL directas contra las tablas de la tienda del cliente.
 * El mapeo de tablas/columnas es configurable via `tableMapping` en las credenciales.
 */
export class DatabaseConnector implements ICommerceConnector {
  readonly connectorName = 'DirectDatabase';
  private readonly logger = new Logger(DatabaseConnector.name);
  private readonly creds: DatabaseCredentials;
  private readonly mapping: TableMapping;
  private readonly currency: string;
  private pool: any = null;

  constructor(credentials: DatabaseCredentials) {
    this.creds = credentials;
    this.mapping = credentials.tableMapping ?? DEFAULT_TABLE_MAPPING;
    this.currency = credentials.currency || '$';
  }

  /**
   * Obtiene (o crea) el pool de conexión según el driver.
   * Se crea de forma perezosa en la primera llamada.
   */
  private async getPool(): Promise<any> {
    if (this.pool) return this.pool;

    const { driver, host, port, database, user, password } = this.creds;

    if (driver === 'postgresql') {
      const { Pool } = await import('pg');
      this.pool = new Pool({
        host,
        port,
        database,
        user,
        password,
        max: 5,
        idleTimeoutMillis: 30000,
      });
      this.logger.log(`Pool PostgreSQL creado: ${host}:${port}/${database}`);
    } else if (driver === 'mysql') {
      const mysql = await import('mysql2/promise');
      this.pool = mysql.createPool({
        host,
        port,
        database,
        user,
        password,
        waitForConnections: true,
        connectionLimit: 5,
      });
      this.logger.log(`Pool MySQL creado: ${host}:${port}/${database}`);
    } else {
      throw new Error(`Driver no soportado para DatabaseConnector: "${driver}"`);
    }

    return this.pool;
  }

  /**
   * Ejecuta un query SQL parametrizado según el driver.
   * PostgreSQL usa $1, $2... / MySQL usa ?
   */
  private async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const pool = await this.getPool();
    const { driver } = this.creds;

    if (driver === 'postgresql') {
      // PostgreSQL: parámetros $1, $2, ...
      const pgSql = sql.replace(/\?/g, (_, i) => `$${i + 1}`);
      const result = await pool.query(pgSql, params);
      return result.rows as T[];
    } else {
      // MySQL: parámetros ?
      const [rows] = await pool.execute(sql, params);
      return rows as T[];
    }
  }

  /**
   * Construye el operador ILIKE o LIKE según el driver para búsqueda
   * case-insensitive.
   */
  private likeOperator(): string {
    return this.creds.driver === 'postgresql' ? 'ILIKE' : 'LIKE';
  }

  // ─── ICommerceConnector ────────────────────────────────────────────────

  async buscarProductos(
    query: string,
    opciones: { limite?: number; categoria?: string } = {},
  ): Promise<ProductDto[]> {
    const limite = Math.min(opciones.limite || 5, 10);
    const m = this.mapping.columns.product;
    const like = this.likeOperator();
    const params: any[] = [];
    const conditions: string[] = [];

    if (query && query.trim()) {
      params.push(`%${query.trim()}%`);
      conditions.push(`${m.name} ${like} ?`);
    }

    if (opciones.categoria) {
      const catId = await this.resolveCategoryId(opciones.categoria);
      if (catId) {
        params.push(catId);
        conditions.push(`${m.categoryId} = ?`);
      }
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `SELECT * FROM ${this.mapping.products} ${whereClause} LIMIT ?`;
    params.push(limite);

    const rows = await this.query<any>(sql, params);
    return rows.map((row) => this.toProductDto(row));
  }

  async obtenerCategorias(): Promise<CategoryDto[]> {
    const m = this.mapping.columns.category;
    const sql = `SELECT ${m.id}, ${m.name}${m.count ? `, ${m.count}` : ''} FROM ${this.mapping.categories}`;
    const rows = await this.query<any>(sql);

    return rows.map((row) => ({
      id: String(row[m.id]),
      nombre: row[m.name],
      cantidad: m.count ? Number(row[m.count]) || 0 : 0,
    }));
  }

  async verStock(
    productoId: string,
  ): Promise<Pick<ProductDto, 'id' | 'nombre' | 'disponible' | 'stock'>> {
    const m = this.mapping.columns.product;
    const sql = `SELECT ${m.id}, ${m.name}, ${m.stock}${m.stockStatus ? `, ${m.stockStatus}` : ''} FROM ${this.mapping.products} WHERE ${m.id} = ? LIMIT 1`;
    const rows = await this.query<any>(sql, [productoId]);

    if (rows.length === 0) {
      throw new Error(`Producto con ID "${productoId}" no encontrado.`);
    }

    const row = rows[0];
    const stock = m.stock ? Number(row[m.stock]) : null;
    const disponible = m.stockStatus
      ? String(row[m.stockStatus]).toLowerCase() === 'instock'
      : stock !== null ? stock > 0 : true;

    return {
      id: String(row[m.id]),
      nombre: row[m.name],
      disponible,
      stock,
    };
  }

  async verEstadoPedido(pedidoId: string): Promise<OrderDto> {
    const om = this.mapping.columns.order;
    const im = this.mapping.columns.orderItem;

    // Obtener el pedido
    const orderSql = `SELECT * FROM ${this.mapping.orders} WHERE ${om.id} = ? LIMIT 1`;
    const orderRows = await this.query<any>(orderSql, [pedidoId]);

    if (orderRows.length === 0) {
      throw new Error(`Pedido con ID "${pedidoId}" no encontrado.`);
    }

    const order = orderRows[0];

    // Obtener los items del pedido
    const itemsSql = `SELECT ${im.productName}, ${im.quantity}, ${im.price} FROM ${this.mapping.orderItems} WHERE ${im.orderId} = ?`;
    const itemRows = await this.query<any>(itemsSql, [pedidoId]);

    return {
      id: String(order[om.id]),
      estado: String(order[om.status] || ''),
      total: `${this.currency}${order[om.total] || '0.00'}`,
      fecha: String(order[om.date] || ''),
      items: itemRows.map((item) => ({
        nombre: String(item[im.productName] || ''),
        cantidad: Number(item[im.quantity]) || 0,
        precio: `${this.currency}${item[im.price] || '0.00'}`,
      })),
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /**
   * Resuelve un valor de categoría (ID numérico o nombre) al ID de la BD.
   * Si es numérico, lo devuelve directo. Si es un nombre, busca en la tabla
   * de categorías.
   */
  private async resolveCategoryId(catValue: string): Promise<string | null> {
    const trimmed = catValue.trim();
    if (!trimmed) return null;

    // Si ya es numérico, devolver directamente
    if (/^\d+$/.test(trimmed)) return trimmed;

    // Es un nombre — buscar en la tabla de categorías
    const m = this.mapping.columns.category;
    const like = this.likeOperator();
    const sql = `SELECT ${m.id} FROM ${this.mapping.categories} WHERE ${m.name} ${like} ? LIMIT 1`;
    const rows = await this.query<any>(sql, [`%${trimmed}%`]);

    if (rows.length > 0) {
      const id = String(rows[0][m.id]);
      this.logger.debug(`Categoría "${trimmed}" resuelta a ID: ${id}`);
      return id;
    }

    this.logger.warn(`No se encontró categoría para el nombre "${trimmed}".`);
    return null;
  }

  /**
   * Mapea una fila de la BD a `ProductDto`.
   */
  private toProductDto(row: any): ProductDto {
    const m = this.mapping.columns.product;
    const stock = m.stock ? Number(row[m.stock]) : null;
    const disponible = m.stockStatus
      ? String(row[m.stockStatus]).toLowerCase() === 'instock'
      : stock !== null ? stock > 0 : true;

    return {
      id: String(row[m.id]),
      nombre: row[m.name],
      precio: `${this.currency}${row[m.price] ?? '0.00'}`,
      disponible,
      stock,
      categorias: [], // Se podría poblar con un JOIN si se necesita
      imagen: m.image ? row[m.image] || null : null,
      url: m.url ? row[m.url] || null : null,
      sku: m.sku ? row[m.sku] || null : null,
      descripcion: m.description ? row[m.description] || null : null,
    };
  }

  /**
   * Cierra el pool de conexión. Lo llama el ConnectorRegistry al invalidar.
   */
  async destroy(): Promise<void> {
    if (this.pool) {
      if (this.creds.driver === 'postgresql') {
        await this.pool.end();
      } else {
        await this.pool.end();
      }
      this.pool = null;
      this.logger.debug('Pool de conexión cerrado.');
    }
  }
}
