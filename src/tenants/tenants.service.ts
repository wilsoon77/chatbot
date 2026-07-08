import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CryptoService } from '../common/crypto/crypto.service';
import { ConnectorRegistry } from '../commerce/connector.registry';

@Injectable()
export class TenantsService {
  constructor(
    private prisma: PrismaService,
    private cryptoService: CryptoService,
    private connectorRegistry: ConnectorRegistry,
  ) {}

  private sanitizeTenant<T>(tenant: T | null) {
    if (!tenant) return null;
    const { ...safeTenant } = tenant as any;
    delete safeTenant.consumerKey;
    delete safeTenant.consumerSecret;
    return safeTenant;
  }

  async create(data: CreateTenantDto) {
    // 1. Crear el Tenant
    const tenant = await this.prisma.tenant.create({
      data: {
        nombre: data.nombre,
        systemPrompt: data.systemPrompt,
        redisTTL: data.redisTTL,
      },
    });

    // 2. Cifrar las credenciales de WooCommerce
    const credsObj = {
      url: data.woocommerceUrl,
      consumerKey: data.consumerKey,
      consumerSecret: data.consumerSecret,
    };
    const encryptedCredentials = this.cryptoService.encrypt(JSON.stringify(credsObj));

    // 3. Crear ConnectorConfig relacionado
    await this.prisma.connectorConfig.create({
      data: {
        tenantId: tenant.id,
        type: 'WOOCOMMERCE',
        credentialsJson: encryptedCredentials,
        enabledToolsJson: JSON.stringify(data.enabledTools || []),
        isDefault: true,
        isActive: true,
      },
    });

    return {
      ...tenant,
      woocommerceUrl: data.woocommerceUrl,
      consumerKey: '••••••••',
      consumerSecret: '••••••••',
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

      let woocommerceUrl = '';
      let enabledTools: string[] = [];

      if (config) {
        try {
          const creds = JSON.parse(this.cryptoService.decrypt(config.credentialsJson));
          woocommerceUrl = creds.url || '';
        } catch {}
        try {
          enabledTools = JSON.parse(config.enabledToolsJson);
        } catch {}
      }

      result.push({
        ...tenant,
        woocommerceUrl,
        consumerKey: '••••••••',
        consumerSecret: '••••••••',
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

    let woocommerceUrl = '';
    let consumerKey = '';
    let consumerSecret = '';
    let enabledTools: string[] = [];

    if (config) {
      try {
        const creds = JSON.parse(this.cryptoService.decrypt(config.credentialsJson));
        woocommerceUrl = creds.url || '';
        consumerKey = creds.consumerKey || '';
        consumerSecret = creds.consumerSecret || '';
      } catch {}
      try {
        enabledTools = JSON.parse(config.enabledToolsJson);
      } catch {}
    }

    return {
      ...tenant,
      woocommerceUrl,
      consumerKey,
      consumerSecret,
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

    let credsObj: any = {};
    if (config) {
      credsObj = JSON.parse(this.cryptoService.decrypt(config.credentialsJson));
    }

    if (data.woocommerceUrl !== undefined) credsObj.url = data.woocommerceUrl;
    if (data.consumerKey !== undefined) credsObj.consumerKey = data.consumerKey;
    if (data.consumerSecret !== undefined) credsObj.consumerSecret = data.consumerSecret;

    const encryptedCredentials = this.cryptoService.encrypt(JSON.stringify(credsObj));
    const enabledToolsJson = data.enabledTools ? JSON.stringify(data.enabledTools) : (config ? config.enabledToolsJson : '[]');

    if (config) {
      await this.prisma.connectorConfig.update({
        where: { id: config.id },
        data: {
          credentialsJson: encryptedCredentials,
          enabledToolsJson,
        },
      });
    } else {
      await this.prisma.connectorConfig.create({
        data: {
          tenantId: id,
          type: 'WOOCOMMERCE',
          credentialsJson: encryptedCredentials,
          enabledToolsJson,
          isDefault: true,
          isActive: true,
        },
      });
    }

    // Invalidar la caché de conectores en caliente para que se carguen las nuevas credenciales/herramientas inmediatamente
    this.connectorRegistry.invalidate(id);

    return {
      ...updated,
      woocommerceUrl: credsObj.url,
      consumerKey: '••••••••',
      consumerSecret: '••••••••',
      enabledTools: data.enabledTools ? data.enabledTools : (config ? JSON.parse(config.enabledToolsJson) : []),
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

    // Retornamos aplanado para compatibilidad
    return {
      ...tenant,
      woocommerceUrl: creds.url,
      consumerKey: creds.consumerKey,
      consumerSecret: creds.consumerSecret,
      enabledTools: JSON.parse(config.enabledToolsJson),
    };
  }
}