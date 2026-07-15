import { IsString, IsArray, IsInt, IsOptional, IsEnum, IsObject } from 'class-validator';
import { ConnectorType } from './connector-credentials.dto.js';

export class CreateTenantDto {
  @IsString()
  nombre!: string;

  @IsString()
  systemPrompt!: string;

  @IsInt()
  @IsOptional()
  redisTTL?: number;

  // ─── Conector ──────────────────────────────────────────────────────────

  @IsEnum(ConnectorType)
  connectorType!: ConnectorType;

  /**
   * Credenciales del conector, la estructura depende de `connectorType`:
   * - WOOCOMMERCE: { url, consumerKey, consumerSecret, currency? }
   * - DIRECT_DATABASE: { driver, host, port, database, user, password, currency?, tableMapping? }
   * - ODOO: { url, database, username, password, ... }
   *
   * Se validan en el service según el tipo, y se cifran antes de guardar.
   */
  @IsObject()
  connectorCredentials!: Record<string, any>;

  @IsArray()
  @IsString({ each: true })
  enabledTools!: string[];
}