import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const logger = new Logger('Bootstrap');

  // Habilita el servicio de archivos estáticos desde el directorio '/public'
  app.useStaticAssets(join(process.cwd(), 'public'));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const isProduction = process.env.NODE_ENV === 'production';
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (requestOrigin, callback) => {
      if (!isProduction && allowedOrigins.length === 0) {
        callback(null, true);
        return;
      }

      callback(null, Boolean(requestOrigin && allowedOrigins.includes(requestOrigin)));
    },
    credentials: false,
  });

  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Chatbot API corriendo en http://localhost:${port}`);
  logger.log(`Health check: http://localhost:${port}/health`);
  logger.log(`Chat endpoint: POST http://localhost:${port}/chat`);
  logger.log(`Widget estático servido en: http://localhost:${port}/widget.js`);
}
bootstrap();
