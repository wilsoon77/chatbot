import { IsString, IsOptional, IsInt, IsEnum, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Tipos de conector soportados.
 * Debe coincidir con el enum `ConnectorType` de Prisma.
 */
export enum ConnectorType {
  WOOCOMMERCE = 'WOOCOMMERCE',
  ODOO = 'ODOO',
  DIRECT_DATABASE = 'DIRECT_DATABASE',
}

// ─── Credenciales por tipo de conector ───────────────────────────────────

/** Credenciales para WooCommerce (API REST). */
export class WooCommerceCredentialsDto {
  @IsString()
  url!: string;

  @IsString()
  consumerKey!: string;

  @IsString()
  consumerSecret!: string;

  @IsString()
  @IsOptional()
  currency?: string;
}

/** Credenciales para conexión directa a BD externa (PostgreSQL o MySQL). */
export class DatabaseCredentialsDto {
  @IsString()
  driver!: 'postgresql' | 'mysql';

  @IsString()
  host!: string;

  @IsInt()
  port!: number;

  @IsString()
  database!: string;

  @IsString()
  user!: string;

  @IsString()
  password!: string;

  @IsString()
  @IsOptional()
  currency?: string;

  /**
   * Mapeo de tablas y columnas de la tienda del cliente.
   * Opcional — si no se envía, se usa el mapeo por defecto.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => TableMappingDto)
  tableMapping?: TableMappingDto;
}

export class TableMappingDto {
  @IsString() products!: string;
  @IsString() categories!: string;
  @IsString() orders!: string;
  @IsString() orderItems!: string;

  @ValidateNested()
  @Type(() => ProductColumnsDto)
  product!: ProductColumnsDto;

  @ValidateNested()
  @Type(() => CategoryColumnsDto)
  category!: CategoryColumnsDto;

  @ValidateNested()
  @Type(() => OrderColumnsDto)
  order!: OrderColumnsDto;

  @ValidateNested()
  @Type(() => OrderItemColumnsDto)
  orderItem!: OrderItemColumnsDto;
}

export class ProductColumnsDto {
  @IsString() id!: string;
  @IsString() name!: string;
  @IsString() price!: string;
  @IsString() stock!: string;
  @IsString() @IsOptional() stockStatus?: string;
  @IsString() @IsOptional() sku?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() image?: string;
  @IsString() @IsOptional() url?: string;
  @IsString() @IsOptional() categoryId?: string;
}

export class CategoryColumnsDto {
  @IsString() id!: string;
  @IsString() name!: string;
  @IsString() @IsOptional() count?: string;
}

export class OrderColumnsDto {
  @IsString() id!: string;
  @IsString() status!: string;
  @IsString() total!: string;
  @IsString() date!: string;
  @IsString() @IsOptional() email?: string;
}

export class OrderItemColumnsDto {
  @IsString() orderId!: string;
  @IsString() productName!: string;
  @IsString() quantity!: string;
  @IsString() price!: string;
}
