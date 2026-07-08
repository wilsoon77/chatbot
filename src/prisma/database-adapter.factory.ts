declare const require: any;

export type SupportedDriver = 'postgresql' | 'mysql' | 'sqlserver';

export function createDatabaseAdapter(driver: SupportedDriver, connectionString: string): any {
  switch (driver) {
    case 'postgresql': {
      const { Pool } = require('pg');
      const { PrismaPg } = require('@prisma/adapter-pg');
      const pool = new Pool({ connectionString });
      return new PrismaPg(pool);
    }
    case 'mysql': {
      const { createPool } = require('mysql2/promise');
      const { PrismaMySQL } = require('@prisma/adapter-mysql');
      const pool = createPool({ uri: connectionString });
      return new PrismaMySQL(pool);
    }
    case 'sqlserver': {
      const { PrismaMsSql } = require('@prisma/adapter-mssql');
      return new PrismaMsSql(connectionString);
    }
    default:
      throw new Error(
        `Driver de base de datos no soportado: "${driver}". ` +
          `Valores válidos: postgresql, mysql, sqlserver`,
      );
  }
}
