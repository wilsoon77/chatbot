export interface ProductDto {
  id: string;
  nombre: string;
  precio: string;
  disponible: boolean;
  stock: number | null;
  categorias: string[];
  imagen: string | null;
  url: string | null;
  sku?: string | null;
  descripcion?: string | null;
}

export interface CategoryDto {
  id: string;
  nombre: string;
  cantidad: number;
}

export interface OrderDto {
  id: string;
  estado: string;
  total: string;
  fecha: string;
  items: Array<{ nombre: string; cantidad: number; precio: string }>;
}

export interface ICommerceConnector {
  readonly connectorName: string;
  buscarProductos(
    query: string,
    opciones?: { limite?: number; categoria?: string },
  ): Promise<ProductDto[]>;
  obtenerCategorias(): Promise<CategoryDto[]>;
  verStock(productoId: string): Promise<Pick<ProductDto, 'id' | 'nombre' | 'disponible' | 'stock'>>;
  verEstadoPedido(pedidoId: string): Promise<OrderDto>;
  healthCheck(): Promise<boolean>;
}
