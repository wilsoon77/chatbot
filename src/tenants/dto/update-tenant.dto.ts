import { IsString, IsArray, IsInt, IsOptional } from 'class-validator';

export class UpdateTenantDto {
  @IsString()
  @IsOptional()
  nombre?: string;

  @IsString()
  @IsOptional()
  systemPrompt?: string;

  @IsString()
  @IsOptional()
  woocommerceUrl?: string;

  @IsString()
  @IsOptional()
  consumerKey?: string;

  @IsString()
  @IsOptional()
  consumerSecret?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  enabledTools?: string[];

  @IsInt()
  @IsOptional()
  redisTTL?: number;
}