import { IsString, IsNotEmpty, MaxLength, IsOptional, Matches } from 'class-validator';

/**
 * DTO para mensajes entrantes al chat.
 * Validado automáticamente por el ValidationPipe de NestJS.
 */
export class ChatMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'El tenant_id es obligatorio' })
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'tenant_id contiene caracteres no válidos' })
  tenant_id!: string;

  @IsString()
  @IsNotEmpty({ message: 'El session_id es obligatorio' })
  @Matches(/^[A-Za-z0-9_-]{16,128}$/, { message: 'session_id contiene caracteres no válidos' })
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
