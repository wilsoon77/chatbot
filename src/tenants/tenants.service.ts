import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
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

const SUPPORTED_TOOLS = new Set([
  'buscar_productos',
  'ver_stock',
  'obtener_categorias',
  'agregar_al_carrito',
]);

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private prisma: PrismaService,
    private cryptoService: CryptoService,
    private connectorRegistry: ConnectorRegistry,
    private config: ConfigService,
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

    if (type === ConnectorType.DIRECT_DATABASE) {
      const port = Number(credentials.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new BadRequestException('El puerto de la base de datos debe estar entre 1 y 65535');
      }
      this.validateDatabaseHost(String(credentials.host));
      this.validateSqlMapping(credentials.tableMapping);
    }

    if (type === ConnectorType.WOOCOMMERCE || type === ConnectorType.ODOO) {
      this.validateRemoteUrl(String(credentials.url));
    }
  }

  /**
   * Enmascara los campos sensibles de las credenciales para enviar al frontend.
   * Devuelve una copia con los campos sensibles reemplazados por "••••••••".
   */
  private validateRemoteUrl(value: string): void {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new BadRequestException('La URL del conector no es válida');
    }

    const isDevelopmentLocal =
      this.config.get('NODE_ENV') !== 'production' &&
      ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !isDevelopmentLocal) {
      throw new BadRequestException('La URL del conector debe usar HTTPS');
    }

    this.validateAllowedHost(parsed.hostname);
  }

  private validateDatabaseHost(host: string): void {
    if (!host || host.length > 253 || /[\s/\\]/.test(host)) {
      throw new BadRequestException('El host de la base de datos no es válido');
    }

    this.validateAllowedHost(host);
    const ipVersion = isIP(host);
    const forbiddenHostnames = new Set([
      'localhost',
      'metadata.google.internal',
      'metadata.google.com',
      'instance-data.ec2.internal',
    ]);
    if (forbiddenHostnames.has(host.toLowerCase())) {
      throw new BadRequestException('El host de la base de datos no está permitido');
    }

    if (ipVersion === 4) {
      const octets = host.split('.').map(Number);
      const [first, second] = octets;
      const privateRange =
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168);
      if (privateRange) {
        throw new BadRequestException('No se permiten hosts privados o de metadata');
      }
    }
  }

  private validateAllowedHost(hostname: string): void {
    const configured = (this.config.get<string>('CONNECTOR_ALLOWED_HOSTS') ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (configured.length > 0) {
      const normalized = hostname.toLowerCase();
      const allowed = configured.some(
        (host) => normalized === host || normalized.endsWith(`.${host}`),
      );
      if (!allowed) {
        throw new BadRequestException('El host no está incluido en CONNECTOR_ALLOWED_HOSTS');
      }
    }
  }

  private validateSqlMapping(mapping: unknown): void {
    if (!mapping || typeof mapping !== 'object') return;

    const values: string[] = [];
    const collect = (value: unknown) => {
      if (typeof value === 'string') values.push(value);
      else if (value && typeof value === 'object') {
        for (const nested of Object.values(value)) collect(nested);
      }
    };
    collect(mapping);

    for (const identifier of values) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/.test(identifier)) {
        throw new BadRequestException('El mapeo contiene un identificador SQL inválido');
      }
    }
  }

  private validateEnabledTools(enabledTools: string[] | undefined): void {
    if (!enabledTools) return;
    const unsupported = enabledTools.filter((tool) => !SUPPORTED_TOOLS.has(tool));
    if (unsupported.length > 0) {
      throw new BadRequestException(`Herramientas no soportadas: ${unsupported.join(', ')}`);
    }
  }

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
    this.validateEnabledTools(data.enabledTools);

    // Cifrar antes de iniciar la transacción para no dejar tenants huérfanos.
    const encryptedCredentials = this.cryptoService.encrypt(
      JSON.stringify(data.connectorCredentials),
    );

    const tenant = await this.prisma.$transaction(async (tx) => {
      const createdTenant = await tx.tenant.create({
        data: {
          nombre: data.nombre,
          systemPrompt: data.systemPrompt,
          redisTTL: data.redisTTL,
        },
      });

      await tx.connectorConfig.create({
        data: {
          tenantId: createdTenant.id,
          type: data.connectorType,
          credentialsJson: encryptedCredentials,
          enabledToolsJson: JSON.stringify(data.enabledTools || []),
          isDefault: true,
          isActive: true,
        },
      });

      return createdTenant;
    },
    );

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
        isActive: data.isActive,
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
      const mergedCredentials = { ...data.connectorCredentials };
      
      // Si el campo de contraseña viene vacío o con la máscara, restaurar la contraseña anterior
      const passwordKeys = ['password', 'consumerSecret', 'consumerKey'];
      passwordKeys.forEach((key) => {
        const val = mergedCredentials[key];
        if (typeof val === 'string' && val.length >= 4 && !/[A-Za-z0-9]/.test(val) && credsObj[key]) {
          mergedCredentials[key] = credsObj[key];
        }
        if (val === undefined || val === '' || val === '••••••••') {
          if (credsObj[key]) {
            mergedCredentials[key] = credsObj[key];
          }
        }
      });

      this.validateCredentials(connectorType, mergedCredentials);
      credsObj = mergedCredentials;
    }

    if (Object.keys(credsObj).length === 0) {
      throw new BadRequestException('Las credenciales del conector son obligatorias');
    }
    this.validateCredentials(connectorType, credsObj);

    const encryptedCredentials = this.cryptoService.encrypt(JSON.stringify(credsObj));
    const enabledToolsJson = data.enabledTools
      ? JSON.stringify(data.enabledTools)
      : (config ? config.enabledToolsJson : '[]');

    this.validateEnabledTools(data.enabledTools);

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
    await this.connectorRegistry.invalidate(id);

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
    await this.connectorRegistry.invalidate(id);

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
