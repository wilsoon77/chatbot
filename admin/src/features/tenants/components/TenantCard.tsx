import { useState } from 'react';
import type { Tenant } from '../service/tenantsService';

const WIDGET_SRC = import.meta.env.VITE_WIDGET_SRC;

interface TenantCardProps {
  tenant: Tenant;
}

export function TenantCard({ tenant }: TenantCardProps) {
  const [showGenerator, setShowGenerator] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [color, setColor] = useState('#3b82f6');
  const [copied, setCopied] = useState(false);

  const scriptCode = `
<script
  src="${WIDGET_SRC}"
  data-tenant="${tenant.id}"
  data-color="${color}"
  data-bot-name="${tenant.nombre}"
></script>
`.trim();

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(scriptCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="tenant-card">

      {/* HEADER (sin cambios) */}
      <div className="tenant-card__header">
        <div className="tenant-card__icon">X</div>
        <div className="tenant-card__info">
          <h3 className="tenant-card__name">{tenant.nombre}</h3>
          <span className="tenant-card__id">ID: {tenant.id}</span>
        </div>
        <span className="tenant-card__badge">Activo</span>
      </div>

      {/* BODY (sin cambios) */}
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
              : <span className="tenant-card__value">—</span>
            }
          </div>
        </div>

        <div className="tenant-card__row">
          <span className="tenant-card__label">System Prompt</span>
          <span className="tenant-card__value tenant-card__value--prompt">
            {tenant.systemPrompt?.slice(0, 80)}
            {tenant.systemPrompt?.length > 80 ? '...' : ''}
          </span>
        </div>
      </div>

      {/* FOOTER + GENERADOR */}
      <div
        className="tenant-card__footer"
        style={{ flexDirection: 'column', gap: 10 }}
      >

        {/* BOTÓN INICIAL */}
        {!showGenerator && (
          <button
            className="tenant-card__btn tenant-card__btn--edit"
            onClick={() => setShowGenerator(true)}
          >
            Generar script de instalación
          </button>
        )}

        {/* CONFIRMACIÓN */}
        {showGenerator && !confirmed && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="tenant-card__btn tenant-card__btn--edit"
              onClick={() => setConfirmed(true)}
            >
              Continuar
            </button>

            <button
              className="tenant-card__btn tenant-card__btn--delete"
              onClick={() => {
                setShowGenerator(false);
                setConfirmed(false);
              }}
            >
              Cancelar
            </button>
          </div>
        )}

        {/* GENERADOR FINAL */}
        {confirmed && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* 🟦 COLOR MÁS CLARO */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                padding: '10px 12px',
                borderRadius: 8
              }}
            >
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                Color del widget
              </span>

              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                style={{
                  width: 44,
                  height: 30,
                  border: 'none',
                  cursor: 'pointer',
                  background: 'transparent'
                }}
              />
            </div>

            {/* 🧪 SCRIPT OUTPUT */}
            <div
              style={{
                background: '#0b0f19',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 8,
                padding: 12
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: '#64748b',
                  marginBottom: 8
                }}
              >
                Script listo para copiar
              </div>

              <pre
                style={{
                  fontSize: 11,
                  color: '#e2e8f0',
                  margin: 0,
                  overflowX: 'auto',
                  lineHeight: 1.4
                }}
              >
                {scriptCode}
              </pre>
            </div>

            {/* 🚀 BOTÓN FINAL */}
            <button
              className="tenant-card__btn tenant-card__btn--edit"
              onClick={copyToClipboard}
              style={{ width: '100%', fontWeight: 600 }}
            >
              {copied ? '✔ Copiado' : 'Copiar script'}
            </button>

          </div>
        )}
      </div>
    </div>
  );
}