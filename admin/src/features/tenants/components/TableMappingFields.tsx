import { useState } from 'react';

// ─── Estructura del mapeo ────────────────────────────────────────────────────

interface TableMapping {
  products: string;
  categories: string;
  orders: string;
  orderItems: string;
  columns: {
    product: {
      id: string;
      name: string;
      price: string;
      stock: string;
      stockStatus?: string;
      sku?: string;
      description?: string;
      image?: string;
      url?: string;
      categoryId?: string;
    };
    category: {
      id: string;
      name: string;
      count?: string;
    };
    order: {
      id: string;
      status: string;
      total: string;
      date: string;
      email?: string;
    };
    orderItem: {
      orderId: string;
      productName: string;
      quantity: string;
      price: string;
    };
  };
}

// ─── Mapeo por defecto ───────────────────────────────────────────────────────

export const DEFAULT_TABLE_MAPPING: TableMapping = {
  products: 'products',
  categories: 'categories',
  orders: 'orders',
  orderItems: 'order_items',
  columns: {
    product: {
      id: 'id',
      name: 'name',
      price: 'price',
      stock: 'stock_quantity',
      stockStatus: 'stock_status',
      sku: 'sku',
      description: 'description',
      image: 'image_url',
      url: 'url',
      categoryId: 'category_id',
    },
    category: {
      id: 'id',
      name: 'name',
      count: 'product_count',
    },
    order: {
      id: 'id',
      status: 'status',
      total: 'total',
      date: 'created_at',
      email: 'customer_email',
    },
    orderItem: {
      orderId: 'order_id',
      productName: 'product_name',
      quantity: 'quantity',
      price: 'price',
    },
  },
};

// ─── Definición de campos ───────────────────────────────────────────────────

interface MappingField {
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
}

const TABLE_FIELDS: MappingField[] = [
  { key: 'products', label: 'Tabla de productos', placeholder: 'products', required: true },
  { key: 'orders', label: 'Tabla de pedidos', placeholder: 'orders', required: true },
  { key: 'orderItems', label: 'Tabla de líneas de pedido', placeholder: 'order_items', required: true },
  { key: 'categories', label: 'Tabla de categorías', placeholder: 'categories', required: true },
];

const PRODUCT_COLUMN_FIELDS: MappingField[] = [
  { key: 'id', label: 'ID', placeholder: 'id', required: true },
  { key: 'name', label: 'Nombre', placeholder: 'name', required: true },
  { key: 'price', label: 'Precio', placeholder: 'price', required: true },
  { key: 'stock', label: 'Stock / Cantidad', placeholder: 'stock_quantity', required: true },
  { key: 'stockStatus', label: 'Estado de stock', placeholder: 'stock_status' },
  { key: 'sku', label: 'SKU / Código', placeholder: 'sku' },
  { key: 'description', label: 'Descripción', placeholder: 'description' },
  { key: 'image', label: 'Imagen (URL)', placeholder: 'image_url' },
  { key: 'url', label: 'URL del producto', placeholder: 'url' },
  { key: 'categoryId', label: 'ID de categoría (FK)', placeholder: 'category_id' },
];

const CATEGORY_COLUMN_FIELDS: MappingField[] = [
  { key: 'id', label: 'ID', placeholder: 'id', required: true },
  { key: 'name', label: 'Nombre', placeholder: 'name', required: true },
  { key: 'count', label: 'Conteo de productos', placeholder: 'product_count' },
];

const ORDER_COLUMN_FIELDS: MappingField[] = [
  { key: 'id', label: 'ID', placeholder: 'id', required: true },
  { key: 'status', label: 'Estado', placeholder: 'status', required: true },
  { key: 'total', label: 'Total', placeholder: 'total', required: true },
  { key: 'date', label: 'Fecha', placeholder: 'created_at', required: true },
  { key: 'email', label: 'Email del cliente', placeholder: 'customer_email' },
];

const ORDER_ITEM_COLUMN_FIELDS: MappingField[] = [
  { key: 'orderId', label: 'ID del pedido', placeholder: 'order_id', required: true },
  { key: 'productName', label: 'Producto', placeholder: 'product_name', required: true },
  { key: 'quantity', label: 'Cantidad', placeholder: 'quantity', required: true },
  { key: 'price', label: 'Precio', placeholder: 'price', required: true },
];

// ─── Componente ──────────────────────────────────────────────────────────────

interface TableMappingFieldsProps {
  /** El mapeo actual (dentro de credentials.tableMapping) */
  mapping: TableMapping | undefined;
  /** Callback cuando el mapeo cambia */
  onChange: (mapping: TableMapping) => void;
}

export function TableMappingFields({ mapping, onChange }: TableMappingFieldsProps) {
  const [expanded, setExpanded] = useState(false);

  // Usar el mapeo proporcionado o el por defecto
  const current: TableMapping = mapping
    ? {
        ...DEFAULT_TABLE_MAPPING,
        ...mapping,
        columns: {
          ...DEFAULT_TABLE_MAPPING.columns,
          ...mapping.columns,
          product: { ...DEFAULT_TABLE_MAPPING.columns.product, ...mapping.columns?.product },
          category: { ...DEFAULT_TABLE_MAPPING.columns.category, ...mapping.columns?.category },
          order: { ...DEFAULT_TABLE_MAPPING.columns.order, ...mapping.columns?.order },
          orderItem: { ...DEFAULT_TABLE_MAPPING.columns.orderItem, ...mapping.columns?.orderItem },
        },
      }
    : DEFAULT_TABLE_MAPPING;

  const updateTable = (key: 'products' | 'categories' | 'orders' | 'orderItems', value: string) => {
    onChange({ ...current, [key]: value });
  };

  const updateProductColumn = (key: string, value: string) => {
    onChange({
      ...current,
      columns: {
        ...current.columns,
        product: { ...current.columns.product, [key]: value || undefined },
      },
    });
  };

  const updateCategoryColumn = (key: string, value: string) => {
    onChange({
      ...current,
      columns: {
        ...current.columns,
        category: { ...current.columns.category, [key]: value || undefined },
      },
    });
  };

  const resetToDefault = () => {
    onChange({ ...DEFAULT_TABLE_MAPPING });
  };

  const isUsingDefault = !mapping;

  return (
    <div className="nt-table-mapping">
      <button
        type="button"
        className="nt-table-mapping__toggle"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="nt-table-mapping__toggle-icon">
          {expanded ? '▼' : '▶'}
        </span>
        <span className="nt-table-mapping__toggle-text">
          Mapeo de tablas y columnas
        </span>
        <span className={`nt-table-mapping__badge ${isUsingDefault ? 'nt-table-mapping__badge--default' : ''}`}>
          {isUsingDefault ? 'Por defecto' : 'Personalizado'}
        </span>
      </button>

      {expanded && (
        <div className="nt-table-mapping__content">
          <p className="nt-hint">
            Configura cómo se llaman las tablas y columnas en la BD de tu tienda.
            Si tu schema usa nombres estándar (products, categories, id, name, price...),
            puedes dejar los valores por defecto.
          </p>

          {/* Nombres de tablas */}
          <div className="nt-table-mapping__section">
            <h4 className="nt-table-mapping__section-title">📋 Nombres de tablas</h4>
            <div className="nt-row">
              {TABLE_FIELDS.map((field) => (
                <div key={field.key} className="nt-field">
                  <label className="nt-label">
                    {field.label}
                    {field.required
                      ? <span className="nt-required">*</span>
                      : <span className="nt-optional">(opcional)</span>}
                  </label>
                  <input
                    className="nt-input nt-input--mono"
                    type="text"
                    placeholder={field.placeholder}
                    value={(current as any)[field.key] ?? ''}
                    onChange={(e) => updateTable(field.key as 'products' | 'categories' | 'orders' | 'orderItems', e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Columnas de producto */}
          <div className="nt-table-mapping__section">
            <h4 className="nt-table-mapping__section-title">📦 Columnas de productos</h4>
            <div className="nt-table-mapping__grid">
              {PRODUCT_COLUMN_FIELDS.map((field) => (
                <div key={field.key} className="nt-field">
                  <label className="nt-label">
                    {field.label}
                    {field.required
                      ? <span className="nt-required">*</span>
                      : <span className="nt-optional">(opcional)</span>}
                  </label>
                  <input
                    className="nt-input nt-input--mono"
                    type="text"
                    placeholder={field.placeholder}
                    value={(current.columns.product as any)[field.key] ?? ''}
                    onChange={(e) => updateProductColumn(field.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Columnas de categoría */}
          <div className="nt-table-mapping__section">
            <h4 className="nt-table-mapping__section-title">🏷️ Columnas de categorías</h4>
            <div className="nt-table-mapping__grid">
              {CATEGORY_COLUMN_FIELDS.map((field) => (
                <div key={field.key} className="nt-field">
                  <label className="nt-label">
                    {field.label}
                    {field.required
                      ? <span className="nt-required">*</span>
                      : <span className="nt-optional">(opcional)</span>}
                  </label>
                  <input
                    className="nt-input nt-input--mono"
                    type="text"
                    placeholder={field.placeholder}
                    value={(current.columns.category as any)[field.key] ?? ''}
                    onChange={(e) => updateCategoryColumn(field.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Columnas de pedido */}
          <div className="nt-table-mapping__section">
            <h4 className="nt-table-mapping__section-title">Columnas de pedidos</h4>
            <div className="nt-table-mapping__grid">
              {ORDER_COLUMN_FIELDS.map((field) => (
                <div key={field.key} className="nt-field">
                  <label className="nt-label">
                    {field.label}
                    {field.required
                      ? <span className="nt-required">*</span>
                      : <span className="nt-optional">(opcional)</span>}
                  </label>
                  <input
                    className="nt-input nt-input--mono"
                    type="text"
                    placeholder={field.placeholder}
                    value={(current.columns.order as any)[field.key] ?? ''}
                    onChange={(e) => onChange({
                      ...current,
                      columns: {
                        ...current.columns,
                        order: { ...current.columns.order, [field.key]: e.target.value || undefined },
                      },
                    })}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Columnas de líneas de pedido */}
          <div className="nt-table-mapping__section">
            <h4 className="nt-table-mapping__section-title">Columnas de líneas de pedido</h4>
            <div className="nt-table-mapping__grid">
              {ORDER_ITEM_COLUMN_FIELDS.map((field) => (
                <div key={field.key} className="nt-field">
                  <label className="nt-label">
                    {field.label}
                    {field.required
                      ? <span className="nt-required">*</span>
                      : <span className="nt-optional">(opcional)</span>}
                  </label>
                  <input
                    className="nt-input nt-input--mono"
                    type="text"
                    placeholder={field.placeholder}
                    value={(current.columns.orderItem as any)[field.key] ?? ''}
                    onChange={(e) => onChange({
                      ...current,
                      columns: {
                        ...current.columns,
                        orderItem: { ...current.columns.orderItem, [field.key]: e.target.value || undefined },
                      },
                    })}
                  />
                </div>
              ))}
            </div>
          </div>

          <button
            type="button"
            className="nt-table-mapping__reset"
            onClick={resetToDefault}
          >
            ↺ Restaurar valores por defecto
          </button>
        </div>
      )}
    </div>
  );
}
