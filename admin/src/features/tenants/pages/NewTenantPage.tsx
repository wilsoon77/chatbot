import { useState } from 'react';
import { tenantsService } from '../service/tenantsService';
import type { ConnectorType } from '../service/tenantsService';
import { CONNECTOR_LABELS } from '../service/tenantsService';
import { ConnectorFields, getDefaultCredentials, validateConnectorCredentials } from '../components/ConnectorFields';
import { Home, Users, Bot, LogOut, ArrowLeft, Plus, ShoppingBag, Database, Briefcase, Key } from 'lucide-react';
import type { Page } from '../../../types/navigation';
import './NewTenantPage.css';
import logo from '../../../assets/images/chatgo.png';

const AVAILABLE_TOOLS = [
  { id: 'buscar_productos',    label: 'Buscar productos' },
  { id: 'ver_stock',           label: 'Ver stock' },
  { id: 'ver_estado_pedido',   label: 'Ver estado de pedido' },
  { id: 'obtener_categorias',  label: 'Obtener categorías' },
  { id: 'agregar_al_carrito',  label: 'Agregar al carrito' },
];

const CONNECTOR_TYPES = Object.entries(CONNECTOR_LABELS) as [ConnectorType, string][];

interface NewTenantPageProps {
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

export function NewTenantPage({ onLogout, onNavigate }: NewTenantPageProps) {
  const [connectorType, setConnectorType] = useState<ConnectorType>('WOOCOMMERCE');
  const [connectorCredentials, setConnectorCredentials] = useState<Record<string, any>>(
    getDefaultCredentials('WOOCOMMERCE'),
  );
  const [form, setForm] = useState({
    nombre: '',
    systemPrompt: '',
    enabledTools: [] as string[],
    redisTTL: 3600,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const handleConnectorTypeChange = (type: ConnectorType) => {
    setConnectorType(type);
    setConnectorCredentials(getDefaultCredentials(type));
    // Limpiar errores de credenciales del tipo anterior
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
    if (!form.nombre.trim())           e.nombre        = 'El nombre es obligatorio.';
    if (!form.systemPrompt.trim())     e.systemPrompt  = 'El system prompt es obligatorio.';
    else if (form.systemPrompt.length > 10000)
                                       e.systemPrompt  = `Máximo 10 000 caracteres (ahora: ${form.systemPrompt.length}).`;
    if (form.enabledTools.length === 0) e.enabledTools  = 'Selecciona al menos una herramienta.';

    // Validar credenciales según el tipo de conector
    const credErrors = validateConnectorCredentials(connectorType, connectorCredentials);
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

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field as keyof FormErrors])
      setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setApiError(null);
    try {
      await tenantsService.create({
        nombre: form.nombre,
        systemPrompt: form.systemPrompt,
        connectorType,
        connectorCredentials,
        enabledTools: form.enabledTools,
        redisTTL: Number(form.redisTTL),
      });
      onNavigate('tenants');
    } catch (err: any) {
      setApiError(err.message || 'Error al crear el bot.');
    } finally {
      setLoading(false);
    }
  };

  const promptLength = form.systemPrompt.length;
  const promptOver   = promptLength > 10000;

  return (
    <div className="dashboard">
      <aside className="dashboard__sidebar">
           <div className="dashboard__logo">
          <img src={logo} alt="ChatGo Logo" />
          <span>Chat-Go</span>
        </div>
        <nav className="dashboard__nav">
          <a className="dashboard__nav-item" href="#" onClick={(e) => { e.preventDefault(); onNavigate('dashboard'); }}>
            <Home className="dashboard__nav-icon" size={18} />
            <span>Inicio</span>
          </a>
          <a className="dashboard__nav-item" href="#" onClick={(e) => { e.preventDefault(); onNavigate('users'); }}>
            <Users className="dashboard__nav-icon" size={18} />
            <span>Usuarios</span>
          </a>
          <a className="dashboard__nav-item dashboard__nav-item--active" href="#" onClick={(e) => e.preventDefault()}>
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
            <span>Nuevo Bot</span>
          </div>
        </header>

        <div className="dashboard__content">
          <form className="new-tenant__form" onSubmit={handleSubmit} noValidate>
            <h1 className="new-tenant__title">Crear nuevo Bot</h1>
            <p className="new-tenant__subtitle">Configura tu asistente virtual para tu tienda.</p>

            {/* Nombre */}
            <div className={`nt-field ${errors.nombre ? 'nt-field--error' : ''}`}>
              <label className="nt-label">Nombre del bot <span className="nt-required">*</span></label>
              <input
                className="nt-input"
                type="text"
                placeholder="Ej: Asistente CODIGOGO"
                value={form.nombre}
                onChange={(e) => handleChange('nombre', e.target.value)}
              />
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
              <textarea
                className="nt-textarea"
                placeholder="Eres el asistente virtual de..."
                rows={10}
                value={form.systemPrompt}
                onChange={(e) => handleChange('systemPrompt', e.target.value)}
              />
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
              </div>
              <ConnectorFields
                type={connectorType}
                credentials={connectorCredentials}
                errors={errors}
                onChange={handleCredentialChange}
              />
            </div>

            {/* Herramientas */}
            <div className={`nt-field ${errors.enabledTools ? 'nt-field--error' : ''}`}>
              <label className="nt-label">Herramientas activas <span className="nt-required">*</span></label>
              <p className="nt-hint">Selecciona al menos una herramienta que usará el bot.</p>
              <div className="nt-tools">
                {AVAILABLE_TOOLS.map((tool) => {
                  const active = form.enabledTools.includes(tool.id);
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      className={`nt-tool ${active ? 'nt-tool--active' : ''}`}
                      onClick={() => toggleTool(tool.id)}
                    >
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
              <p className="nt-hint">Tiempo de vida de la sesión en caché. Por defecto 3600 (1 hora).</p>
              <input
                className="nt-input nt-input--short"
                type="number"
                min={60}
                max={86400}
                value={form.redisTTL}
                onChange={(e) => handleChange('redisTTL', e.target.value)}
              />
            </div>

            {apiError && (
              <div className="nt-api-error">⚠️ {apiError}</div>
            )}

            <div className="nt-actions">
              <button type="button" className="nt-btn-cancel" onClick={() => onNavigate('tenants')}>
                Cancelar
              </button>
              <button type="submit" className="nt-btn-submit" disabled={loading || promptOver}>
                {loading ? 'Creando...' : (
                  <>
                    <Plus size={16} />
                    <span>Crear Bot</span>
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
