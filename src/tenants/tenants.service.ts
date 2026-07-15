import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CryptoService } from '../common/crypto/crypto.service';
import { ConnectorRegistry } from '../commerce/connector.registry';
import { ConnectorType } from './dto/connector-credentials.dto.js';

/**
 * Campos requeridos por tipo de conector.
 * Se usa para validar que las credenciales enviadas tengan todos los campos obligatorios.
 */
const REQUIRED_FIELDS: Record<ConnectorType, string[]> = {
  [ConnectorType.WOOCOMMERCE]: ['url', 'consumerKey', 'consumerSecret'],
  [ConnectorType.DIRECT_DATABASE]: ['driver', 'host', 'port', 'database', 'user', 'password'],
  [ConnectorType.ODOO]: ['url', 'database', 'username', 'password'],
};

/**
 * Campos sensibles que se enmascaran al devolver credenciales al frontend.
 */
const SENSITIVE_FIELDS = new Set([
  'password', 'consumerSecret', 'consumerKey', 'secret', 'token',
]);

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private prisma: PrismaService,
    private cryptoService: CryptoService,
    private connectorRegistry: ConnectorRegistry,
  ) {}

  // ─── Validación de credenciales ─────────────────────────────────────────

  /**
   * Valida que las credenciales tengan todos los campos requeridos según el tipo de conector.
   */
  private validateCredentials(type: ConnectorType, credentials: Record<string, any>): void {
    const required = REQUIRED_FIELDS[type] || [];
    const missing = required.filter((field) => !credentials[field]);

    if (missing.length > 0) {
      throw new BadRequestException(
        `Faltan campos obligatorios para el conector "${type}": ${missing.join(', ')}`,
      );
    }

    // Validación específica para DIRECT_DATABASE
    if (type === ConnectorType.DIRECT_DATABASE) {
      const driver = credentials.driver;
      if (!['postgresql', 'mysql'].includes(driver)) {
        throw new BadRequestException(
          `Driver no soportado: "${driver}". Valores válidos: postgresql, mysql`,
        );
      }
    }
  }

  /**
   * Enmascara los campos sensibles de las credenciales para enviar al frontend.
   * Devuelve una copia con los campos sensibles reemplazados por "••••••••".
   */
  private maskCredentials(credentials: Record<string, any>): Record<string, any> {
    const masked: Record<string, any> = {};
    for (const [key, value] of Object.entries(credentials)) {
      masked[key] = SENSITIVE_FIELDS.has(key) ? '••••••••' : value;
    }
    return masked;
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────

  async create(data: CreateTenantDto) {
    // 1. Validar credenciales según el tipo de conector
    this.validateCredentials(data.connectorType, data.connectorCredentials);

    // 2. Crear el Tenant
    const tenant = await this.prisma.tenant.create({
      data: {
        nombre: data.nombre,
        systemPrompt: data.systemPrompt,
        redisTTL: data.redisTTL,
      },
    });

    // 3. Cifrar las credenciales
    const encryptedCredentials = this.cryptoService.encrypt(
      JSON.stringify(data.connectorCredentials),
    );

    // 4. Crear ConnectorConfig relacionado
    await this.prisma.connectorConfig.create({
      data: {
        tenantId: tenant.id,
        type: data.connectorType,
        credentialsJson: encryptedCredentials,
        enabledToolsJson: JSON.stringify(data.enabledTools || []),
        isDefault: true,
        isActive: true,
      },
    });

    this.logger.log(
      `Tenant "${tenant.nombre}" creado con conector "${data.connectorType}"`,
    );

    return {
      ...tenant,
      connectorType: data.connectorType,
      connectorCredentials: this.maskCredentials(data.connectorCredentials),
      enabledTools: data.enabledTools,
    };
  }

  async findAll() {
    const tenants = await this.prisma.tenant.findMany();
    const result = [];

    for (const tenant of tenants) {
      const config = await this.prisma.connectorConfig.findFirst({
        where: { tenantId: tenant.id, isDefault: true },
      });

      let connectorType: string | null = null;
      let connectorCredentials: Record<string, any> = {};
      let enabledTools: string[] = [];

      if (config) {
        connectorType = config.type;
        try {
          const creds = JSON.parse(this.cryptoService.decrypt(config.credentialsJson));
          connectorCredentials = this.maskCredentials(creds);
        } catch {}
        try {
          enabledTools = JSON.parse(config.enabledToolsJson);
        } catch {}
      }

      result.push({
        ...tenant,
        connectorType,
        connectorCredentials,
        enabledTools,
      });
    }

    return result;
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) return null;

    const config = await this.prisma.connectorConfig.findFirst({
      where: { tenantId: id, isDefault: true },
    });

    let connectorType: string | null = null;
    let connectorCredentials: Record<string, any> = {};
    let enabledTools: string[] = [];

    if (config) {
      connectorType = config.type;
      try {
        const creds = JSON.parse(this.cryptoService.decrypt(config.credentialsJson));
        connectorCredentials = this.maskCredentials(creds);
      } catch {}
      try {
        enabledTools = JSON.parse(config.enabledToolsJson);
      } catch {}
    }

    return {
      ...tenant,
      connectorType,
      connectorCredentials,
      enabledTools,
    };
  }

  async update(id: string, data: UpdateTenantDto) {
    const exists = await this.prisma.tenant.findUnique({ where: { id } });
    if (!exists)
      throw new NotFoundException(`Tenant con id "${id}" no encontrado`);

    // 1. Actualizar datos base del Tenant
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        nombre: data.nombre,
        systemPrompt: data.systemPrompt,
        redisTTL: data.redisTTL,
      },
    });

    // 2. Obtener o crear ConnectorConfig por defecto
    let config = await this.prisma.connectorConfig.findFirst({
      where: { tenantId: id, isDefault: true },
    });

    // 3. Determinar el tipo de conector (nuevo o existente)
    const connectorType = data.connectorType ?? (config?.type as ConnectorType) ?? ConnectorType.WOOCOMMERCE;

    // 4. Manejar credenciales
    let credsObj: Record<string, any> = {};
    if (config) {
      try {
        credsObj = JSON.parse(this.cryptoService.decrypt(config.credentialsJson));
      } catch {}
    }

    // Si se envían credenciales nuevas, validarlas y reemplazar
    if (data.connectorCredentials) {
      this.validateCredentials(connectorType, data.connectorCredentials);
      credsObj = data.connectorCredentials;
    }

    const encryptedCredentials = this.cryptoService.encrypt(JSON.stringify(credsObj));
    const enabledToolsJson = data.enabledTools
      ? JSON.stringify(data.enabledTools)
      : (config ? config.enabledToolsJson : '[]');

    if (config) {
      await this.prisma.connectorConfig.update({
        where: { id: config.id },
        data: {
          type: connectorType,
          credentialsJson: encryptedCredentials,
          enabledToolsJson,
        },
      });
    } else {
      await this.prisma.connectorConfig.create({
        data: {
          tenantId: id,
          type: connectorType,
          credentialsJson: encryptedCredentials,
          enabledToolsJson,
          isDefault: true,
          isActive: true,
        },
      });
    }

    // Invalidar la caché de conectores en caliente
    this.connectorRegistry.invalidate(id);

    this.logger.log(`Tenant "${updated.nombre}" actualizado (conector: ${connectorType})`);

    return {
      ...updated,
      connectorType,
      connectorCredentials: this.maskCredentials(credsObj),
      enabledTools: data.enabledTools
        ? data.enabledTools
        : (config ? JSON.parse(config.enabledToolsJson) : []),
    };
  }

  async remove(id: string) {
    const exists = await this.prisma.tenant.findUnique({ where: { id } });
    if (!exists)
      throw new NotFoundException(`Tenant con id "${id}" no encontrado`);

    await this.prisma.tenant.delete({ where: { id } });

    return {
      message: `Tenant "${exists.nombre}" eliminado correctamente`,
    };
  }

  // ⚡ NUEVO: activar/desactivar tenant
  async toggleActive(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });

    if (!tenant) {
      throw new NotFoundException(`Tenant con id "${id}" no encontrado`);
    }

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { isActive: !tenant.isActive },
    });

    const isActive = updated.isActive;

    return {
      id: updated.id,
      nombre: updated.nombre,
      isActive,
      message: `Tenant "${updated.nombre}" ${isActive ? 'activado' : 'desactivado'} correctamente`,
    };
  }

  // uso interno (chat / widget / fallback compatibilidad)
  async getTenantConfig(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) return null;
    if (!tenant.isActive) return null;

    // Buscar configuracion
    const config = await this.prisma.connectorConfig.findFirst({
      where: { tenantId: id, isDefault: true, isActive: true },
    });

    if (!config) return null;

    const creds = JSON.parse(this.cryptoService.decrypt(config.credentialsJson));

    // Retornamos el tipo de conector y las credenciales descifradas.
    // Para compatibilidad hacia atrás, también aplanamos campos de WooCommerce
    // si el conector es de ese tipo (chat.service usa tenant.woocommerceUrl).
    const isWoo = config.type === 'WOOCOMMERCE';

    return {
      ...tenant,
      connectorType: config.type,
      connectorCredentials: creds,
      // Compatibilidad hacia atrás (WooCommerce)
      woocommerceUrl: isWoo ? creds.url : undefined,
      consumerKey: isWoo ? creds.consumerKey : undefined,
      consumerSecret: isWoo ? creds.consumerSecret : undefined,
      enabledTools: JSON.parse(config.enabledToolsJson),
    };
  }
}