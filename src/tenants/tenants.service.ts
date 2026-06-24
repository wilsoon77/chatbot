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
    // Verificar que el tenant existe antes de actualizar
    const exists = await this.prisma.tenant.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException(`Tenant con id "${id}" no encontrado`);

    // Solo encriptar las llaves si vienen en el body
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
    // Verificar que el tenant existe antes de eliminar
    const exists = await this.prisma.tenant.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException(`Tenant con id "${id}" no encontrado`);

    await this.prisma.tenant.delete({ where: { id } });

    return { message: `Tenant "${exists.nombre}" eliminado correctamente` };
  }

  // Para uso interno: aquí sí devuelve las llaves descifradas
  async getTenantConfig(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) return null;

    return {
      ...tenant,
      consumerKey: this.cryptoService.decrypt(tenant.consumerKey),
      consumerSecret: this.cryptoService.decrypt(tenant.consumerSecret),
    };
  }
}