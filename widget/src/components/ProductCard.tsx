import { ShoppingCart, ImageOff } from 'lucide-react';

export interface WooProductItem {
  id: number;
  nombre: string;
  precio: string;
  disponible: boolean;
  stock: number | null;
  categorias: string;
  imagen: string | null;
  url: string;
}

interface ProductCardProps {
  product: WooProductItem;
}

export function ProductCard({ product }: ProductCardProps) {
  // Procesar precio para separar precio actual y precio anterior si está en oferta.
  // Ejemplo: "Q79.99 (antes Q99.00)" o simplemente "Q79.99"
  const priceMatch = product.precio.match(/^([^\(]+)(?:\(antes\s+([^\)]+)\))?/);
  const currentPrice = priceMatch ? priceMatch[1].trim() : product.precio;
  const oldPrice = priceMatch && priceMatch[2] ? priceMatch[2].trim() : null;
  const isOnSale = !!oldPrice;

  return (
    <div className="chatbot-product-card">
      <div className="chatbot-product-img-container">
        {product.imagen ? (
          <img
            src={product.imagen}
            alt={product.nombre}
            className="chatbot-product-img"
            loading="lazy"
          />
        ) : (
          <div className="chatbot-product-no-img">
            <ImageOff size={24} />
            <span>Sin imagen</span>
          </div>
        )}
        {isOnSale && <div className="chatbot-product-badge">Oferta</div>}
      </div>

      <div className="chatbot-product-info">
        <h4 className="chatbot-product-name" title={product.nombre}>
          {product.nombre}
        </h4>

        <div className="chatbot-product-price-row">
          {isOnSale ? (
            <div>
              <span className="chatbot-product-price">{currentPrice}</span>
              <span className="chatbot-product-old-price">{oldPrice}</span>
            </div>
          ) : (
            <span className="chatbot-product-price">{currentPrice}</span>
          )}
        </div>

        <div
          className={`chatbot-product-stock ${
            product.disponible ? 'instock' : 'outofstock'
          }`}
        >
          {product.disponible ? (
            <>
              <span style={{ marginRight: '3px' }}>●</span>Disponible
              {product.stock !== null && product.stock > 0 ? ` (${product.stock} u.)` : ''}
            </>
          ) : (
            <>
              <span style={{ marginRight: '3px' }}>●</span>Agotado
            </>
          )}
        </div>

        <a
          href={product.url}
          target="_blank"
          rel="noopener noreferrer"
          className="chatbot-product-btn"
        >
          <ShoppingCart size={13} />
          <span>Ver Producto</span>
        </a>
      </div>
    </div>
  );
}
