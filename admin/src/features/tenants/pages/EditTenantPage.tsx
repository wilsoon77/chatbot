import { useState } from 'react';
import { tenantsService } from '../service/tenantsService';
import type { Tenant, ConnectorType } from '../service/tenantsService';
import { CONNECTOR_LABELS } from '../service/tenantsService';
import { ConnectorFields, getDefaultCredentials, validateConnectorCredentials } from '../components/ConnectorFields';
import { Home, Users, Bot, LogOut, ArrowLeft, Check, ShoppingBag, Database, Briefcase, Key } from 'lucide-react';
import type { Page } from '../../../types/navigation';
import './EditTenantPage.css';

const AVAILABLE_TOOLS = [
  { id: 'buscar_productos',    label: 'Buscar productos' },
  { id: 'ver_stock',           label: 'Ver stock' },
  { id: 'ver_estado_pedido',   label: 'Ver estado de pedido' },
  { id: 'obtener_categorias',  label: 'Obtener categorías' },
  { id: 'agregar_al_carrito',  label: 'Agregar al carrito' },
];

const CONNECTOR_TYPES = Object.entries(CONNECTOR_LABELS) as [ConnectorType, string][];

interface EditTenantPageProps {
  tenant: Tenant;
  onLogout: () => void;
  onNavigate: (page: Page) => void;
}

interface FormErrors {
  nombre?: string;
  systemPrompt?: string;
  connectorType?: string;
  enabledTools?: string;
  [key: string]: string | undefined;
}

export function EditTenantPage({ tenant, onLogout, onNavigate }: EditTenantPageProps) {
  const initialConnectorType = (tenant.connectorType || 'WOOCOMMERCE') as ConnectorType;
  // Las credenciales que vienen del backend tienen los campos sensibles enmascarados ("••••••••").
  // Las limpiamos para que en la UI aparezcan vacías y puedan ser editadas.
  const initialCredentials = { ...(tenant.connectorCredentials || getDefaultCredentials(initialConnectorType)) };
  Object.keys(initialCredentials).forEach((key) => {
    if (initialCredentials[key] === '••••••••') {
      initialCredentials[key] = '';
    }
  });

  const [connectorType, setConnectorType] = useState<ConnectorType>(initialConnectorType);
  const [connectorCredentials, setConnectorCredentials] = useState<Record<string, any>>(initialCredentials);
  const [form, setForm] = useState({
    nombre:         tenant.nombre,
    systemPrompt:   tenant.systemPrompt,
    enabledTools:   tenant.enabledTools ?? [],
    redisTTL:       tenant.redisTTL,
  });
  const [errors,   setErrors]   = useState<FormErrors>({});
  const [loading,  setLoading]  = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const handleConnectorTypeChange = (type: ConnectorType) => {
    setConnectorType(type);
    // Al cambiar de tipo, resetear credenciales a los valores por defecto del nuevo tipo
    setConnectorCredentials(getDefaultCredentials(type));
    setErrors((prev) => {
      const cleaned = { ...prev };
      Object.keys(cleaned).forEach((key) => {
        if (key.includes('.')) delete cleaned[key];
      });
      return cleaned;
    });
  };

  const handleCredentialChange = (key: string, value: string) => {
    setConnectorCredentials((prev) => ({ ...prev, [key]: value }));
    const errorKey = `${connectorType}.${key}`;
    if (errors[errorKey]) setErrors((prev) => ({ ...prev, [errorKey]: undefined }));
  };

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!form.nombre.trim())          e.nombre        = 'El nombre es obligatorio.';
    if (!form.systemPrompt.trim())    e.systemPrompt  = 'El system prompt es obligatorio.';
    else if (form.systemPrompt.length > 10000)
                                      e.systemPrompt  = `Máximo 10 000 caracteres (ahora: ${form.systemPrompt.length}).`;
    if (form.enabledTools.length === 0) e.enabledTools = 'Selecciona al menos una herramienta.';

    // Validar credenciales (en modo edición, password vacío = mantener existente)
    const credErrors = validateConnectorCredentials(connectorType, connectorCredentials, true);
    Object.assign(e, credErrors);

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const toggleTool = (tool: string) => {
    setForm((prev) => ({
      ...prev,
      enabledTools: prev.enabledTools.includes(tool)
        ? prev.enabledTools.filter((t) => t !== tool)
        : [...prev.enabledTools, tool],
    }));
    if (errors.enabledTools) setErrors((e) => ({ ...e, enabledTools: undefined }));
  };

  const handleChange = (field: keyof typeof form, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field as keyof FormErrors])
      setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setApiError(null);

    // Construir payload: incluimos siempre las credenciales, el backend se encargará
    // de conservar los passwords antiguos si se envían vacíos.
    const payload: Record<string, unknown> = {
      nombre:         form.nombre,
      systemPrompt:   form.systemPrompt,
      enabledTools:   form.enabledTools,
      redisTTL:       Number(form.redisTTL),
      connectorType,
      connectorCredentials,
    };

    try {
      await tenantsService.update(tenant.id, payload);
      onNavigate('tenants');
    } catch (err: any) {
      setApiError(err.message || 'Error al actualizar el bot.');
    } finally {
      setLoading(false);
    }
  };

  const promptLength = form.systemPrompt.length;
  const promptOver   = promptLength > 10000;

  return (
    <div className="dashboard">
      <aside className="dashboard__sidebar">
        <div className="dashboard__logo"><span>💬</span><span>Chat-Go</span></div>
        <nav className="dashboard__nav">
          <a className="dashboard__nav-item" href="#" onClick={(e) => { e.preventDefault(); onNavigate('dashboard'); }}>
            <Home className="dashboard__nav-icon" size={18} />
            <span>Inicio</span>
          </a>
          <a className="dashboard__nav-item" href="#" onClick={(e) => { e.preventDefault(); onNavigate('users'); }}>
            <Users className="dashboard__nav-icon" size={18} />
            <span>Usuarios</span>
          </a>
          <a className="dashboard__nav-item dashboard__nav-item--active" href="#" onClick={(e) => { e.preventDefault(); onNavigate('tenants'); }}>
            <Bot className="dashboard__nav-icon" size={18} />
            <span>Tenants</span>
          </a>
        </nav>
        <button className="dashboard__logout" onClick={onLogout}>
          <LogOut size={16} />
          <span>Cerrar sesión</span>
        </button>
      </aside>

      <main className="dashboard__main">
        <header className="dashboard__header">
          <div className="new-tenant__breadcrumb">
            <button className="new-tenant__back" onClick={() => onNavigate('tenants')}>
              <ArrowLeft size={16} />
              <span>Volver a Tenants</span>
            </button>
            <span className="new-tenant__breadcrumb-sep">/</span>
            <span>Editar — {tenant.nombre}</span>
          </div>
        </header>

        <div className="dashboard__content">
          <form className="new-tenant__form" onSubmit={handleSubmit} noValidate>
            <h1 className="new-tenant__title">Editar Bot</h1>
            <p className="new-tenant__subtitle">Los campos de clave se envían solo si los modificas.</p>

            {/* Nombre */}
            <div className={`nt-field ${errors.nombre ? 'nt-field--error' : ''}`}>
              <label className="nt-label">Nombre del bot <span className="nt-required">*</span></label>
              <input className="nt-input" type="text" value={form.nombre}
                onChange={(e) => handleChange('nombre', e.target.value)} />
              {errors.nombre && <p className="nt-error">{errors.nombre}</p>}
            </div>

            {/* System Prompt */}
            <div className={`nt-field ${errors.systemPrompt ? 'nt-field--error' : ''}`}>
              <label className="nt-label">
                System Prompt <span className="nt-required">*</span>
                <span className={`nt-counter ${promptOver ? 'nt-counter--over' : ''}`}>
                  {promptLength.toLocaleString()} / 10 000
                </span>
              </label>
              <textarea className="nt-textarea" rows={10} value={form.systemPrompt}
                onChange={(e) => handleChange('systemPrompt', e.target.value)} />
              {errors.systemPrompt && <p className="nt-error">{errors.systemPrompt}</p>}
            </div>

            {/* Selector de tipo de conector */}
            <div className={`nt-field ${errors.connectorType ? 'nt-field--error' : ''}`}>
              <label className="nt-label">Tipo de conector <span className="nt-required">*</span></label>
              <p className="nt-hint">Selecciona la plataforma de e-commerce o BD de tu tienda.</p>
              <div className="nt-connector-types">
                {CONNECTOR_TYPES.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`nt-connector-type ${connectorType === value ? 'nt-connector-type--active' : ''}`}
                    onClick={() => handleConnectorTypeChange(value)}
                  >
                    <span className="nt-connector-type__icon">
                      {value === 'WOOCOMMERCE' ? <ShoppingBag size={20} /> : value === 'DIRECT_DATABASE' ? <Database size={20} /> : <Briefcase size={20} />}
                    </span>
                    <span className="nt-connector-type__label">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Credenciales dinámicas según el tipo de conector */}
            <div className="nt-keys-section">
              <div className="nt-keys-header">
                <span className="nt-keys-title">
                  <Key size={16} className="nt-keys-title-icon" />
                  <span>Credenciales — {CONNECTOR_LABELS[connectorType]}</span>
                </span>
                <span className="nt-keys-hint">Déjalas vacías para no modificarlas</span>
              </div>
              <ConnectorFields
                type={connectorType}
                credentials={connectorCredentials}
                errors={errors}
                onChange={handleCredentialChange}
                isEdit
              />
            </div>

            {/* Herramientas */}
            <div className={`nt-field ${errors.enabledTools ? 'nt-field--error' : ''}`}>
              <label className="nt-label">Herramientas activas <span className="nt-required">*</span></label>
              <p className="nt-hint">Selecciona al menos una herramienta.</p>
              <div className="nt-tools">
                {AVAILABLE_TOOLS.map((tool) => {
                  const active = form.enabledTools.includes(tool.id);
                  return (
                    <button key={tool.id} type="button"
                      className={`nt-tool ${active ? 'nt-tool--active' : ''}`}
                      onClick={() => toggleTool(tool.id)}>
                      <span className="nt-tool__check">{active ? '✓' : '+'}</span>
                      {tool.label}
                    </button>
                  );
                })}
              </div>
              {errors.enabledTools && <p className="nt-error">{errors.enabledTools}</p>}
            </div>

            {/* Redis TTL */}
            <div className="nt-field">
              <label className="nt-label">Redis TTL (segundos)</label>
              <p className="nt-hint">Tiempo de vida de sesión en caché.</p>
              <input className="nt-input nt-input--short" type="number" min={60} max={86400}
                value={form.redisTTL} onChange={(e) => handleChange('redisTTL', e.target.value)} />
            </div>

            {apiError && <div className="nt-api-error">⚠️ {apiError}</div>}

            <div className="nt-actions">
              <button type="button" className="nt-btn-cancel" onClick={() => onNavigate('tenants')}>Cancelar</button>
              <button type="submit" className="nt-btn-submit" disabled={loading || promptOver}>
                {loading ? 'Guardando...' : (
                  <>
                    <Check size={16} />
                    <span>Guardar cambios</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
