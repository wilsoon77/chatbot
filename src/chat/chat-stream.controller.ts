import { Controller, Post, Body, Res, HttpCode, Logger } from '@nestjs/common';
import * as express from 'express';
import { ChatService } from './chat.service.js';
import { ChatMessageDto } from './dto/chat-message.dto.js';

/**
 * Controlador para streaming de Chat.
 * Endpoint principal: POST /chat/stream
 */
@Controller('chat')
export class ChatStreamController {
  private readonly logger = new Logger(ChatStreamController.name);

  constructor(private readonly chatService: ChatService) {}

  @Post('stream')
  @HttpCode(200)
  async handleMessageStream(
    @Body() dto: ChatMessageDto,
    @Res() res: express.Response,
  ): Promise<void> {
    this.logger.log(
      `Mensaje streaming recibido — tenant: ${dto.tenant_id} | session: ${dto.session_id}`,
    );

    // Configurar cabeceras HTTP para Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'none'); // Evita problemas de compresión (gzipping)
    res.flushHeaders();

    try {
      await this.chatService.processMessageStream(
        dto.tenant_id,
        dto.session_id,
        dto.message,
        // Callback para tokens de texto
        async (token) => {
          res.write(`event: token\ndata: ${JSON.stringify({ content: token })}\n\n`);
        },
        // Callback para carrusel de productos
        async (products) => {
          res.write(`event: products\ndata: ${JSON.stringify({ products })}\n\n`);
        },
        // Callback para acciones automatizadas (ej: agregar al carrito)
        async (action) => {
          res.write(`event: action\ndata: ${JSON.stringify({ action })}\n\n`);
        },
      );

      // Señalizar al cliente que la transmisión ha terminado exitosamente
      res.write(`event: done\ndata: {}\n\n`);
    } catch (error) {
      this.logger.error(`Error en el controlador de streaming: ${(error as Error).message}`);
      res.write(`event: error\ndata: ${JSON.stringify({ message: (error as Error).message })}\n\n`);
    } finally {
      res.end();
    }
  }
}
