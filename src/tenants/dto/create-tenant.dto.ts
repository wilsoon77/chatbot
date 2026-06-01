import { IsString, IsArray, IsInt, IsOptional } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  nombre!: string;

  @IsString()
  systemPrompt!: string;

  @IsString()
  woocommerceUrl!: string;

  @IsString()
  consumerKey!: string;

  @IsString()
  consumerSecret!: string;

  @IsArray()
  @IsString({ each: true })
  enabledTools!: string[];

  @IsInt()
  @IsOptional()
  redisTTL?: number;
}