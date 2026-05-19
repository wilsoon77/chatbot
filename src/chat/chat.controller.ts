import { Controller, Post, Body, Logger, HttpCode } from '@nestjs/common';
import { ChatService } from './chat.service.js';
import { ChatMessageDto, ChatResponseDto } from './dto/chat-message.dto.js';

/**
 * Controlador del chat.
 * Endpoint principal: POST /chat
 */
@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(200)
  async handleMessage(@Body() dto: ChatMessageDto): Promise<ChatResponseDto> {
    this.logger.log(
      `Mensaje recibido — tenant: ${dto.tenant_id} | session: ${dto.session_id}`,
    );

    const reply = await this.chatService.processMessage(
      dto.tenant_id,
      dto.session_id,
      dto.message,
    );

    return {
      reply,
      session_id: dto.session_id,
    };
  }
}
