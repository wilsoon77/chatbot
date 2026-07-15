import { useState } from 'react';

// ─── Estructura del mapeo ────────────────────────────────────────────────────

interface TableMapping {
  products: string;
  categories: string;
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
  };
}

// ─── Mapeo por defecto ───────────────────────────────────────────────────────

export const DEFAULT_TABLE_MAPPING: TableMapping = {
  products: 'products',
  categories: 'categories',
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
  const current: TableMapping = mapping ?? DEFAULT_TABLE_MAPPING;

  const updateTable = (key: 'products' | 'categories', value: string) => {
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
                    value={current[field.key] ?? ''}
                    onChange={(e) => updateTable(field.key as 'products' | 'categories', e.target.value)}
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
