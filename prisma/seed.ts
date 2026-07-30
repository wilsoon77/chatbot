import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { createDatabaseAdapter, SupportedDriver } from '../src/prisma/database-adapter.factory';

dotenv.config();

function getPrismaClient(): PrismaClient {
  const driver = (process.env.DATABASE_DRIVER || 'postgresql') as SupportedDriver;
  let url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error('DATABASE_URL no está definida en las variables de entorno.');
  }

  // Si se ejecuta fuera del contenedor de Docker (en host local), sustituye @postgres: por @localhost:
  if (process.env.NODE_ENV !== 'production' && url.includes('@postgres:')) {
    url = url.replace('@postgres:', '@localhost:');
  }

  const adapter = createDatabaseAdapter(driver, url);
  return new PrismaClient({ adapter });
}

const prisma = getPrismaClient();

async function main() {
  const userCount = await prisma.user.count();

  if (userCount === 0) {
    const defaultEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@chatbot.com';
    const defaultPassword = process.env.INITIAL_ADMIN_PASSWORD || 'admin123';
    const defaultUsername = process.env.INITIAL_ADMIN_USERNAME || 'admin';

    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const admin = await prisma.user.create({
      data: {
        username: defaultUsername,
        email: defaultEmail,
        password: hashedPassword,
        role: Role.ADMIN,
      },
    });

    console.log(`🌱 Usuario Administrador inicial creado con éxito: ${admin.email}`);
  } else {
    console.log(`ℹ️ La base de datos ya contiene ${userCount} usuarios. Se omite la semilla inicial.`);
  }
}

main()
  .catch((e) => {
    console.error('❌ Error ejecutando el seed de Prisma:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
