import { useState } from 'react';
import { tenantsService } from '../service/tenantsService';
import type { Page } from '../../../types/navigation';
import './NewTenantPage.css';

const AVAILABLE_TOOLS = [
  { id: 'buscar_productos',    label: 'Buscar productos' },
  { id: 'ver_stock',           label: 'Ver stock' },
  { id: 'ver_estado_pedido',   label: 'Ver estado de pedido' },
  { id: 'obtener_categorias',  label: 'Obtener categorías' },
  { id: 'agregar_al_carrito',  label: 'Agregar al carrito' },
];

interface NewTenantPageProps {
  onLogout: () => void;
  onNavigate: (page: Page) => void;
}

interface FormErrors {
  nombre?: string;
  systemPrompt?: string;
  woocommerceUrl?: string;
  consumerKey?: string;
  consumerSecret?: string;
  enabledTools?: string;
}

export function NewTenantPage({ onLogout, onNavigate }: NewTenantPageProps) {
  const [form, setForm] = useState({
    nombre: '',
    systemPrompt: '',
    woocommerceUrl: '',
    consumerKey: '',
    consumerSecret: '',
    enabledTools: [] as string[],
    redisTTL: 3600,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!form.nombre.trim())           e.nombre        = 'El nombre es obligatorio.';
    if (!form.systemPrompt.trim())     e.systemPrompt  = 'El system prompt es obligatorio.';
    else if (form.systemPrompt.length > 10000)
                                       e.systemPrompt  = `Máximo 10 000 caracteres (ahora: ${form.systemPrompt.length}).`;
    if (!form.woocommerceUrl.trim())   e.woocommerceUrl = 'La URL de WooCommerce es obligatoria.';
    if (!form.consumerKey.trim())      e.consumerKey   = 'El Consumer Key es obligatorio.';
    if (!form.consumerSecret.trim())   e.consumerSecret = 'El Consumer Secret es obligatorio.';
    if (form.enabledTools.length === 0) e.enabledTools  = 'Selecciona al menos una herramienta.';
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
      await tenantsService.create(form);
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
          <span>💬</span>
          <span>Chat-Go</span>
        </div>
        <nav className="dashboard__nav">
          <a className="dashboard__nav-item" href="#" onClick={(e) => { e.preventDefault(); onNavigate('dashboard'); }}>Inicio</a>
          <a className="dashboard__nav-item" href="#" onClick={(e) => { e.preventDefault(); onNavigate('users'); }}>Usuarios</a>
          <a className="dashboard__nav-item dashboard__nav-item--active" href="#" onClick={(e) => { e.preventDefault(); onNavigate('tenants'); }}>Tenants</a>
        </nav>
        <button className="dashboard__logout" onClick={onLogout}>Cerrar sesión</button>
      </aside>

      <main className="dashboard__main">
        <header className="dashboard__header">
          <div className="new-tenant__breadcrumb">
            <button className="new-tenant__back" onClick={() => onNavigate('tenants')}>← Tenants</button>
            <span className="new-tenant__breadcrumb-sep">/</span>
            <span>Nuevo Bot</span>
          </div>
        </header>

        <div className="dashboard__content">
          <form className="new-tenant__form" onSubmit={handleSubmit} noValidate>
            <h1 className="new-tenant__title">Crear nuevo Bot</h1>
            <p className="new-tenant__subtitle">Configura tu asistente virtual para WooCommerce.</p>

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

            {/* WooCommerce URL */}
            <div className={`nt-field ${errors.woocommerceUrl ? 'nt-field--error' : ''}`}>
              <label className="nt-label">URL de WooCommerce <span className="nt-required">*</span></label>
              <input
                className="nt-input"
                type="url"
                placeholder="https://mitienda.com"
                value={form.woocommerceUrl}
                onChange={(e) => handleChange('woocommerceUrl', e.target.value)}
              />
              {errors.woocommerceUrl && <p className="nt-error">{errors.woocommerceUrl}</p>}
            </div>

            {/* Keys en fila */}
            <div className="nt-row">
              <div className={`nt-field ${errors.consumerKey ? 'nt-field--error' : ''}`}>
                <label className="nt-label">Consumer Key <span className="nt-required">*</span></label>
                <input
                  className="nt-input nt-input--mono"
                  type="text"
                  placeholder="ck_..."
                  value={form.consumerKey}
                  onChange={(e) => handleChange('consumerKey', e.target.value)}
                />
                {errors.consumerKey && <p className="nt-error">{errors.consumerKey}</p>}
              </div>
              <div className={`nt-field ${errors.consumerSecret ? 'nt-field--error' : ''}`}>
                <label className="nt-label">Consumer Secret <span className="nt-required">*</span></label>
                <input
                  className="nt-input nt-input--mono"
                  type="password"
                  placeholder="cs_..."
                  value={form.consumerSecret}
                  onChange={(e) => handleChange('consumerSecret', e.target.value)}
                />
                {errors.consumerSecret && <p className="nt-error">{errors.consumerSecret}</p>}
              </div>
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
                {loading ? 'Creando...' : '＋ Crear Bot'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
