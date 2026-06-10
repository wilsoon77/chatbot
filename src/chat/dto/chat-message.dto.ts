import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';

/**
 * DTO para mensajes entrantes al chat.
 * Validado automáticamente por el ValidationPipe de NestJS.
 */
export class ChatMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'El tenant_id es obligatorio' })
  tenant_id!: string;

  @IsString()
  @IsNotEmpty({ message: 'El session_id es obligatorio' })
  session_id!: string;

  @IsString()
  @IsNotEmpty({ message: 'El mensaje no puede estar vacío' })
  @MaxLength(2000, { message: 'El mensaje no puede exceder 2000 caracteres' })
  message!: string;
}

export class ChatResponseDto {
  reply!: string;
  session_id!: string;

  @IsOptional()
  model_info?: Record<string, unknown>;

  @IsOptional()
  products?: any[];

  @IsOptional()
  action?: {
    type: string;
    payload: Record<string, any>;
  };
}
