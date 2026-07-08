import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createDatabaseAdapter, SupportedDriver } from './database-adapter.factory.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const driver = (process.env.DATABASE_DRIVER || 'postgresql') as SupportedDriver;
    const url = process.env.DATABASE_URL;

    if (!url) {
      throw new Error('DATABASE_URL no está definida en las variables de entorno.');
    }

    const adapter = createDatabaseAdapter(driver, url);
    super({ adapter });

    this.logger.log(`PrismaService inicializado con driver: ${driver}`);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}