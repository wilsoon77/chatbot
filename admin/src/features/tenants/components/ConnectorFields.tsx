import type { ConnectorType, WooCommerceCredentials, DatabaseCredentials } from '../service/tenantsService';
import { TableMappingFields } from './TableMappingFields';

// ─── Definición de campos por tipo de conector ─────────────────────────────

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'select';
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  halfWidth?: boolean;
}

const WOO_FIELDS: FieldDef[] = [
  { key: 'url', label: 'URL de WooCommerce', type: 'text', placeholder: 'https://mitienda.com', required: true },
  { key: 'consumerKey', label: 'Consumer Key', type: 'text', placeholder: 'ck_...', required: true, halfWidth: true },
  { key: 'consumerSecret', label: 'Consumer Secret', type: 'password', placeholder: 'cs_...', required: true, halfWidth: true },
  { key: 'currency', label: 'Símbolo de moneda', type: 'text', placeholder: '$', halfWidth: true },
];

const DB_FIELDS: FieldDef[] = [
  {
    key: 'driver',
    label: 'Driver de BD',
    type: 'select',
    required: true,
    options: [
      { value: 'postgresql', label: 'PostgreSQL' },
      { value: 'mysql', label: 'MySQL / MariaDB' },
    ],
  },
  { key: 'host', label: 'Host', type: 'text', placeholder: '10.0.0.5', required: true, halfWidth: true },
  { key: 'port', label: 'Puerto', type: 'number', placeholder: '5432', required: true, halfWidth: true },
  { key: 'database', label: 'Base de datos', type: 'text', placeholder: 'tienda_db', required: true, halfWidth: true },
  { key: 'user', label: 'Usuario', type: 'text', placeholder: 'readonly_user', required: true, halfWidth: true },
  { key: 'password', label: 'Contraseña', type: 'password', placeholder: '••••••••', required: true, halfWidth: true },
  { key: 'currency', label: 'Símbolo de moneda', type: 'text', placeholder: '$', halfWidth: true },
];

const ODOO_FIELDS: FieldDef[] = [
  { key: 'url', label: 'URL de Odoo', type: 'text', placeholder: 'https://mi-empresa.odoo.com', required: true },
  { key: 'database', label: 'Base de datos', type: 'text', placeholder: 'mi_empresa', required: true, halfWidth: true },
  { key: 'username', label: 'Usuario', type: 'text', placeholder: 'admin', required: true, halfWidth: true },
  { key: 'password', label: 'Contraseña / API Key', type: 'password', placeholder: '••••••••', required: true, halfWidth: true,
    hint: 'Odoo 14+: usa API Key. Odoo 13-: usa el password del usuario.' },
  { key: 'currency', label: 'Símbolo de moneda', type: 'text', placeholder: '$', halfWidth: true },
];

export function getConnectorFields(type: ConnectorType): FieldDef[] {
  switch (type) {
    case 'WOOCOMMERCE': return WOO_FIELDS;
    case 'DIRECT_DATABASE': return DB_FIELDS;
    case 'ODOO': return ODOO_FIELDS;
    default: return [];
  }
}

// ─── Valores por defecto ─────────────────────────────────────────────────────

export function getDefaultCredentials(type: ConnectorType): Record<string, any> {
  switch (type) {
    case 'WOOCOMMERCE':
      return { url: '', consumerKey: '', consumerSecret: '', currency: '$' } as WooCommerceCredentials;
    case 'DIRECT_DATABASE':
      return { driver: 'postgresql', host: '', port: 5432, database: '', user: '', password: '', currency: '$' } as DatabaseCredentials;
    case 'ODOO':
      return { url: '', database: '', username: '', password: '', currency: '$' };
    default:
      return {};
  }
}

// ─── Renderizado de campos ──────────────────────────────────────────────────

interface ConnectorFieldsProps {
  type: ConnectorType;
  credentials: Record<string, any>;
  errors: Record<string, string | undefined>;
  onChange: (key: string, value: string) => void;
  /** Si true, los campos de password se muestran vacíos (modo edición) */
  isEdit?: boolean;
}

export function ConnectorFields({ type, credentials, errors, onChange, isEdit }: ConnectorFieldsProps) {
  const fields = getConnectorFields(type);

  // Agrupar campos en pares para el layout de dos columnas
  const rows: FieldDef[][] = [];
  let i = 0;
  while (i < fields.length) {
    if (i + 1 < fields.length && fields[i].halfWidth && fields[i + 1].halfWidth) {
      rows.push([fields[i], fields[i + 1]]);
      i += 2;
    } else if (fields[i].halfWidth) {
      rows.push([fields[i]]);
      i += 1;
    } else {
      rows.push([fields[i]]);
      i += 1;
    }
  }

  return (
    <div className="nt-connector-fields">
      {rows.map((row, rowIdx) => (
        <div key={rowIdx} className={row.length === 2 ? 'nt-row' : ''}>
          {row.map((field) => {
            const errorKey = `${type}.${field.key}`;
            const value = credentials[field.key] ?? '';
            const displayValue = isEdit && field.type === 'password' ? '' : value;

            return (
              <div key={field.key} className={`nt-field ${errors[errorKey] ? 'nt-field--error' : ''}`}>
                <label className="nt-label">
                  {field.label}
                  {field.required
                    ? <span className="nt-required">*</span>
                    : <span className="nt-optional">(opcional)</span>}
                </label>

                {field.type === 'select' ? (
                  <select
                    className="nt-input"
                    value={value}
                    onChange={(e) => onChange(field.key, e.target.value)}
                  >
                    {field.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={`nt-input ${field.type === 'password' ? 'nt-input--mono' : ''} ${field.halfWidth ? '' : ''}`}
                    type={field.type}
                    placeholder={isEdit && field.type === 'password' ? '•••••••• (dejar vacío para mantener)' : field.placeholder}
                    value={displayValue}
                    onChange={(e) => onChange(field.key, e.target.value)}
                  />
                )}

                {field.hint && <p className="nt-hint">{field.hint}</p>}
                {errors[errorKey] && <p className="nt-error">{errors[errorKey]}</p>}
              </div>
            );
          })}
        </div>
      ))}

      {/* Mapeo de tablas — solo para BD directa */}
      {type === 'DIRECT_DATABASE' && (
        <TableMappingFields
          mapping={credentials.tableMapping}
          onChange={(mapping) => onChange('tableMapping', mapping as any)}
        />
      )}
    </div>
  );
}

// ─── Validación ──────────────────────────────────────────────────────────────

export function validateConnectorCredentials(
  type: ConnectorType,
  credentials: Record<string, any>,
  isEdit: boolean = false,
): Record<string, string | undefined> {
  const errors: Record<string, string | undefined> = {};
  const fields = getConnectorFields(type);

  for (const field of fields) {
    if (!field.required) continue;

    // En modo edición, no validar campos de password vacíos (se mantienen los existentes)
    if (isEdit && field.type === 'password' && !credentials[field.key]) continue;

    const value = credentials[field.key];
    if (!value || (typeof value === 'string' && !value.trim())) {
      errors[`${type}.${field.key}`] = `${field.label} es obligatorio.`;
    }
  }

  return errors;
}
