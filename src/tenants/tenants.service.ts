import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { CryptoService } from '../common/crypto/crypto.service';



@Injectable()
export class TenantsService {
  constructor(
    private prisma: PrismaService,
    private cryptoService: CryptoService,
  ) {}

  private sanitizeTenant<T extends { consumerKey?: string; consumerSecret?: string }>(
    tenant: T | null,
  ) {
    if (!tenant) return null;
    const { consumerKey, consumerSecret, ...safeTenant } = tenant as any;
    return safeTenant;
  }

  async create(data: CreateTenantDto) {
    const encryptedData = {
      ...data,
      consumerKey: this.cryptoService.encrypt(data.consumerKey),
      consumerSecret: this.cryptoService.encrypt(data.consumerSecret),
    };

    const tenant = await this.prisma.tenant.create({
      data: encryptedData,
    });

    return this.sanitizeTenant(tenant);
  }

  async findAll() {
    const tenants = await this.prisma.tenant.findMany();
    return tenants.map((tenant) => this.sanitizeTenant(tenant));
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    return this.sanitizeTenant(tenant);
  }

  async update(id: string, data: UpdateTenantDto) {
    const exists = await this.prisma.tenant.findUnique({ where: { id } });
    if (!exists)
      throw new NotFoundException(`Tenant con id "${id}" no encontrado`);

    const dataToUpdate: any = { ...data };

    if (data.consumerKey) {
      dataToUpdate.consumerKey = this.cryptoService.encrypt(data.consumerKey);
    }

    if (data.consumerSecret) {
      dataToUpdate.consumerSecret = this.cryptoService.encrypt(data.consumerSecret);
    }

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: dataToUpdate,
    });

    return this.sanitizeTenant(updated);
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
      // tenant may not have isActive typed on the generated type, cast to any
      data: { isActive: !(tenant as any).isActive },
    });

    const isActive = (updated as any).isActive;

    return {
      id: updated.id,
      nombre: updated.nombre,
      isActive,
      message: `Tenant "${updated.nombre}" ${isActive ? 'activado' : 'desactivado'} correctamente`,
    };
  }

  //  uso interno (chat / widget)
  async getTenantConfig(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) return null;

    //  bloquea si está desactivado
    if (!(tenant as any).isActive) return null;

    return {
      ...tenant,
      consumerKey: this.cryptoService.decrypt(tenant.consumerKey),
      consumerSecret: this.cryptoService.decrypt(tenant.consumerSecret),
    };
  }
}