import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CryptoService } from '../common/crypto/crypto.service.js';
import { ICommerceConnector, CategoryDto } from './commerce.interfaces.js';
import { WooCommerceConnector } from './connectors/woocommerce.connector.js';
import { DatabaseConnector } from './connectors/database.connector.js';
import { OdooConnector } from './connectors/odoo.connector.js';

/** TTL del caché de categorías en milisegundos (1 hora por defecto). */
const CATEGORY_CACHE_TTL_MS = Number(process.env.CATEGORY_CACHE_TTL_MS) || 60 * 60 * 1000;

interface CachedCategories {
  data: CategoryDto[];
  timestamp: number;
}

@Injectable()
export class ConnectorRegistry {
  private readonly logger = new Logger(ConnectorRegistry.name);

  // Caché en memoria: tenantId → ICommerceConnector
  private readonly cache = new Map<string, ICommerceConnector>();

  // Caché de categorías: tenantId → { data, timestamp }
  private readonly categoryCache = new Map<string, CachedCategories>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Resuelve el conector activo y por defecto para un tenant.
   */
  async getConnector(tenantId: string): Promise<ICommerceConnector> {
    if (this.cache.has(tenantId)) {
      return this.cache.get(tenantId)!;
    }

    const config = await this.prisma.connectorConfig.findFirst({
      where: { tenantId, isDefault: true, isActive: true },
    });

    if (!config) {
      throw new NotFoundException(
        `No se encontró un conector activo y por defecto configurado para el tenant con ID: ${tenantId}`,
      );
    }

    // Descifrar credenciales
    let credentials: any;
    try {
      credentials = JSON.parse(this.crypto.decrypt(config.credentialsJson));
    } catch (error) {
      this.logger.error(
        `Error al descifrar credenciales del conector para tenant "${tenantId}": ${(error as Error).message}`,
      );
      throw new NotFoundException(
        `Las credenciales del conector para el tenant "${tenantId}" no pudieron descifrarse o están corruptas.`,
      );
    }

    const connector = this.buildConnector(config.type, credentials);
    this.cache.set(tenantId, connector);

    this.logger.log(`Conector "${config.type}" inicializado para tenant: ${tenantId}`);
    return connector;
  }

  /**
   * Invalida el caché de un tenant (conector + categorías).
   */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
    this.categoryCache.delete(tenantId);
    this.logger.debug(`Caché de conector y categorías invalidado para tenant: ${tenantId}`);
  }

  /**
   * Obtiene las categorías de la tienda para inyectarlas en el system prompt.
   *
   * Usa un caché en memoria con TTL configurable (por defecto 1 hora) para
   * evitar llamar a la API de WooCommerce en cada request. Si el conector o la
   * llamada fallan, devuelve null (graceful degradation — el prompt se genera
   * sin categorías).
   *
   * @param tenantId  ID del tenant.
   * @returns Lista de categorías, o null si no se pudieron obtener.
   */
  async getCategoriesForContext(tenantId: string): Promise<CategoryDto[] | null> {
    // Verificar caché fresco
    const cached = this.categoryCache.get(tenantId);
    if (cached && Date.now() - cached.timestamp < CATEGORY_CACHE_TTL_MS) {
      this.logger.debug(`Categorías servidas desde caché para tenant: ${tenantId}`);
      return cached.data;
    }

    try {
      const connector = await this.getConnector(tenantId);
      const categories = await connector.obtenerCategorias();

      if (categories && categories.length > 0) {
        this.categoryCache.set(tenantId, { data: categories, timestamp: Date.now() });
        this.logger.debug(
          `Categorías cacheadas para tenant "${tenantId}": ${categories.length} categorías`,
        );
      }
      return categories;
    } catch (error) {
      this.logger.warn(
        `No se pudieron obtener categorías para el tenant "${tenantId}": ${(error as Error).message}. ` +
          'El prompt se generará sin contexto de categorías.',
      );
      return null;
    }
  }

  private buildConnector(type: string, credentials: any): ICommerceConnector {
    switch (type) {
      case 'WOOCOMMERCE':
        return new WooCommerceConnector(credentials);
      case 'DIRECT_DATABASE':
        return new DatabaseConnector(credentials);
      case 'ODOO':
        return new OdooConnector(credentials);
      default:
        throw new Error(`Tipo de conector no soportado: "${type}"`);
    }
  }
}
