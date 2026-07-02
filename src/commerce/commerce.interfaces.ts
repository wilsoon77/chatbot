export interface ProductDto {
  id: number;
  nombre: string;
  precio: string;
  disponible: boolean;
  stock: number | string | null;
  categorias: string;
  imagen: string | null;
  url: string;
}

export interface OrderDto {
  id: number;
  estado: string;
  total: string;
  metodo_pago: string;
  fecha: string;
  items: Array<{
    producto: string;
    cantidad: number;
    total: string;
  }>;
}

export interface CategoryDto {
  id: number;
  nombre: string;
  slug: string;
  total_productos: number;
}

export const COMMERCE_CONNECTOR_TOKEN = Symbol('ICommerceConnector');

export interface ICommerceConnector {
  searchProducts(
    tenantId: string,
    query: string,
    categoryId?: string,
    limit?: number,
  ): Promise<{ products: ProductDto[]; usedFallback: boolean } | null>;

  getProductStock(
    tenantId: string,
    productId: number,
  ): Promise<{ id: number; nombre: string; disponible: boolean; stock: number | string }>;

  getOrderState(
    tenantId: string,
    orderId: number,
    email: string,
  ): Promise<OrderDto | string>;

  getCategories(tenantId: string): Promise<CategoryDto[]>;
}
