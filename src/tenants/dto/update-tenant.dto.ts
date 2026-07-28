import {
  IsString,
  IsArray,
  IsInt,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsObject,
  Min,
  Max,
} from 'class-validator';
import { ConnectorType } from './connector-credentials.dto.js';

export class UpdateTenantDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsOptional()
  systemPrompt?: string;

  @IsInt()
  @IsOptional()
  @Min(60)
  @Max(86400)
  redisTTL?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // ─── Conector ──────────────────────────────────────────────────────────

  @IsEnum(ConnectorType)
  @IsOptional()
  connectorType?: ConnectorType;

  /**
   * Credenciales del conector. Si se envían, reemplazan las existentes.
   * La estructura depende de `connectorType`.
   */
  @IsObject()
  @IsOptional()
  connectorCredentials?: Record<string, any>;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  enabledTools?: string[];
}
