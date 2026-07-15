import { useState } from 'react';
import type { Tenant } from '../service/tenantsService';
import { CONNECTOR_LABELS } from '../service/tenantsService';
import { tenantsService } from '../service/tenantsService';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import './TenantCard.css';

const WIDGET_SRC = import.meta.env.VITE_WIDGET_SRC;

interface TenantCardProps {
  tenant: Tenant;
  onEdit: (tenant: Tenant) => void;
  onDeleted: () => void;
}

export function TenantCard({ tenant, onEdit, onDeleted }: TenantCardProps) {
  const [showGenerator, setShowGenerator] = useState(false);
  const [color,         setColor]         = useState('#3b82f6');
  const [copied,        setCopied]        = useState(false);
  const [showDelete,    setShowDelete]    = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [isActive,      setIsActive]      = useState<boolean>(!!tenant.isActive);
  const [toggling,      setToggling]      = useState(false);

  const scriptCode = `<script\n  src="${WIDGET_SRC}"\n  data-tenant="${tenant.id}"\n  data-color="${color}"\n  data-bot-name="${tenant.nombre}">\n<\/script>`.trim();

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(scriptCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await (tenantsService as any).delete(tenant.id);
      onDeleted();
    } catch {
      setDeleting(false);
      setShowDelete(false);
    }
  };

  const handleToggle = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      const token = localStorage.getItem('access_token');
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const res = await fetch(`${API_URL}/admin/tenants/${tenant.id}/toggle`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error');
      setIsActive((prev: boolean) => !prev);
    } catch {
      // no cambia estado si falla
    } finally {
      setToggling(false);
    }
  };

  const COLORS = ['#3b82f6', '#6e14f5', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6'];

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

      {/* ── MODAL GENERADOR DE SCRIPT ── */}
      {showGenerator && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowGenerator(false)}
        >
          <div
            style={{
              background: '#1e293b', borderRadius: 16, padding: 28,
              width: '100%', maxWidth: 480, boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
              border: '1px solid #334155',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header modal */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>
                  ⟨/⟩ Script de integración
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
                  {tenant.nombre} · {tenant.id.slice(0, 12)}...
                </p>
              </div>
              <button
                onClick={() => setShowGenerator(false)}
                style={{
                  background: '#334155', border: 'none', borderRadius: 8,
                  width: 32, height: 32, cursor: 'pointer', color: '#94a3b8',
                  fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >✕</button>
            </div>

            {/* Color picker */}
            <div style={{ marginBottom: 20 }}>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Color del widget
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    style={{
                      width: 28, height: 28, borderRadius: '50%', background: c,
                      border: color === c ? '3px solid #fff' : '3px solid transparent',
                      cursor: 'pointer', outline: color === c ? `2px solid ${c}` : 'none',
                      transition: 'transform 0.15s',
                      transform: color === c ? 'scale(1.15)' : 'scale(1)',
                    }}
                    title={c}
                  />
                ))}
                {/* Custom color */}
                <label style={{ position: 'relative', width: 28, height: 28, borderRadius: '50%', cursor: 'pointer', overflow: 'hidden', border: '2px dashed #475569' }} title="Color personalizado">
                  <span style={{ fontSize: 16, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</span>
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                    style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                </label>
                <div style={{
                  marginLeft: 4, display: 'flex', alignItems: 'center', gap: 6,
                  background: '#0f172a', borderRadius: 8, padding: '4px 10px',
                }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: color }} />
                  <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>{color}</span>
                </div>
              </div>
            </div>

            {/* Code block */}
            <div style={{
              background: '#0f172a', borderRadius: 10, padding: 16,
              border: '1px solid #1e3a5f', marginBottom: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: '#475569', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  HTML · Pega esto en tu sitio
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e' }} />
                </div>
              </div>
              <pre style={{
                margin: 0, fontSize: 12, lineHeight: 1.7, color: '#7dd3fc',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>{scriptCode}</pre>
            </div>

            {/* Botón copiar */}
            <button
              onClick={copyToClipboard}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
                background: copied ? '#16a34a' : 'linear-gradient(135deg, #3b82f6, #6366f1)',
                color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                transition: 'all 0.2s', letterSpacing: '0.02em',
              }}
            >
              {copied ? '✔  Copiado al portapapeles' : '⎘  Copiar script'}
            </button>
          </div>
        </div>
      )}

      {/* ── CARD ── */}
      <div className="tenant-card">
        {/* HEADER */}
        <div className="tenant-card__header">
          <div className="tenant-card__icon">⚡</div>
          <div className="tenant-card__info">
            <h3 className="tenant-card__name">{tenant.nombre}</h3>
            <span className="tenant-card__id">ID: {tenant.id}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span className={`tenant-card__badge ${isActive ? '' : 'tenant-card__badge--inactive'}`}>
              {isActive ? 'Activo' : 'Inactivo'}
            </span>
            <button
              onClick={handleToggle}
              disabled={toggling}
              style={{
                position: 'relative', display: 'inline-flex', alignItems: 'center',
                width: 44, height: 24, borderRadius: 9999, border: 'none',
                cursor: toggling ? 'not-allowed' : 'pointer', padding: 2,
                transition: 'background 0.3s', background: isActive ? '#22c55e' : '#475569',
                opacity: toggling ? 0.6 : 1,
              }}
              title={isActive ? 'Desactivar chatbot' : 'Activar chatbot'}
            >
              <span style={{
                display: 'block', width: 20, height: 20, borderRadius: 9999,
                background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                transition: 'transform 0.3s',
                transform: isActive ? 'translateX(20px)' : 'translateX(0px)',
              }} />
            </button>
          </div>
        </div>

        {/* BODY */}
        <div className="tenant-card__body">
          <div className="tenant-card__row">
            <span className="tenant-card__label">Conector</span>
            <span className="tenant-card__value">
              {tenant.connectorType
                ? CONNECTOR_LABELS[tenant.connectorType] || tenant.connectorType
                : '—'}
            </span>
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

        {/* FOOTER */}
        <div className="tenant-card__footer">
          <button
            className="tenant-card__btn tenant-card__btn--script"
            onClick={() => setShowGenerator(true)}
          >
            ⟨/⟩ Generar script
          </button>
          <div className="tenant-card__footer-row">
            <button className="tenant-card__btn tenant-card__btn--edit" onClick={() => onEdit(tenant)}>
              Editar
            </button>
            <button className="tenant-card__btn tenant-card__btn--delete" onClick={() => setShowDelete(true)}>
              Eliminar
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
