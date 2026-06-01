import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // Validación global de DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      
      transform: true,
    }),
  );

  // CORS — permitir todas las origenes en desarrollo
  app.enableCors({
    origin: process.env.NODE_ENV === 'production' ? false : '*',
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`🤖 Chatbot API corriendo en http://localhost:${port}`);
  logger.log(`📋 Health check: http://localhost:${port}/health`);
  logger.log(`💬 Chat endpoint: POST http://localhost:${port}/chat`);
}
bootstrap();
