import { useState } from 'react';
import type { Tenant } from '../service/tenantsService';
import { tenantsService } from '../service/tenantsService';
import { DeleteConfirmModal } from './DeleteConfirmModal';


const WIDGET_SRC = import.meta.env.VITE_WIDGET_SRC;

interface TenantCardProps {
  tenant: Tenant;
  onEdit: (tenant: Tenant) => void;
  onDeleted: () => void;
}

export function TenantCard({ tenant, onEdit, onDeleted }: TenantCardProps) {
  const [showGenerator, setShowGenerator] = useState(false);
  const [confirmed,     setConfirmed]     = useState(false);
  const [color,         setColor]         = useState('#3b82f6');
  const [copied,        setCopied]        = useState(false);
  const [showDelete,    setShowDelete]    = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  const scriptCode = `<script\n  src="${WIDGET_SRC}"\n  data-tenant="${tenant.id}"\n  data-color="${color}"\n  data-bot-name="${tenant.nombre}">\n<\/script>`.trim();

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(scriptCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      // tenantsService type may not expose a "delete" method in typings — cast to any to call it if available
      await (tenantsService as any).delete(tenant.id);
      onDeleted();
    } catch {
      setDeleting(false);
      setShowDelete(false);
    }
  };

  return (
    <>
      {showDelete && (
        <DeleteConfirmModal
          tenantName={tenant.nombre}
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
          loading={deleting}
        />
      )}

      <div className="tenant-card">
        {/* HEADER */}
        <div className="tenant-card__header">
          <div className="tenant-card__icon">X</div>
          <div className="tenant-card__info">
            <h3 className="tenant-card__name">{tenant.nombre}</h3>
            <span className="tenant-card__id">ID: {tenant.id}</span>
          </div>
          <span className="tenant-card__badge">Activo</span>
        </div>

        {/* BODY */}
        <div className="tenant-card__body">
          <div className="tenant-card__row">
            <span className="tenant-card__label">URL WooCommerce</span>
            <span className="tenant-card__value">{tenant.woocommerceUrl || '—'}</span>
          </div>
          <div className="tenant-card__row">
            <span className="tenant-card__label">TTL Redis</span>
            <span className="tenant-card__value">{tenant.redisTTL}s</span>
          </div>
          <div className="tenant-card__row">
            <span className="tenant-card__label">Tools activas</span>
            <div className="tenant-card__tools">
              {tenant.enabledTools?.length > 0
                ? tenant.enabledTools.map((t) => (
                    <span key={t} className="tenant-card__tool">{t}</span>
                  ))
                : <span className="tenant-card__value">—</span>}
            </div>
          </div>
          <div className="tenant-card__row">
            <span className="tenant-card__label">System Prompt</span>
            <span className="tenant-card__value tenant-card__value--prompt">
              {tenant.systemPrompt?.slice(0, 80)}{tenant.systemPrompt?.length > 80 ? '...' : ''}
            </span>
          </div>
        </div>

        {/* GENERADOR DE SCRIPT */}
        <div className="tenant-card__footer" style={{ flexDirection: 'column', gap: 10 }}>
          {!showGenerator && (
            <button className="tenant-card__btn tenant-card__btn--script"
              onClick={() => setShowGenerator(true)}>
              ⟨/⟩ Generar script
            </button>
          )}

          {showGenerator && !confirmed && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="tenant-card__btn tenant-card__btn--script"
                onClick={() => setConfirmed(true)}>Continuar</button>
              <button className="tenant-card__btn tenant-card__btn--delete"
                onClick={() => { setShowGenerator(false); setConfirmed(false); }}>Cancelar</button>
            </div>
          )}

          {confirmed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="tenant-card__color-row">
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Color del widget</span>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                  style={{ width: 44, height: 30, border: 'none', cursor: 'pointer', background: 'transparent' }} />
              </div>
              <div className="tenant-card__code-block">
                <div className="tenant-card__code-label">Script listo para copiar</div>
                <pre className="tenant-card__code">{scriptCode}</pre>
              </div>
              <button className="tenant-card__btn tenant-card__btn--script"
                onClick={copyToClipboard} style={{ width: '100%', fontWeight: 600 }}>
                {copied ? '✔ Copiado' : 'Copiar script'}
              </button>
              <button className="tenant-card__btn tenant-card__btn--cancel-script"
                onClick={() => { setShowGenerator(false); setConfirmed(false); }}>
                Cerrar
              </button>
            </div>
          )}

          {/* Editar / Eliminar */}
          {!confirmed && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="tenant-card__btn tenant-card__btn--edit"
                onClick={() => onEdit(tenant)}>
                Editar
              </button>
              <button className="tenant-card__btn tenant-card__btn--delete"
                onClick={() => setShowDelete(true)}>
                Eliminar
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
