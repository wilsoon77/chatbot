import { useTenants } from '../hooks/useTenants';
import { TenantCard } from '../components/TenantCard';
import './TenantsPage.css';


import type { Page } from '../../../types/navigation';

interface TenantsPageProps {
  onLogout: () => void;
  onNavigate: (page: Page) => void;
}
export function TenantsPage({ onLogout, onNavigate }: TenantsPageProps) {
  const { tenants, loading, error, refetch } = useTenants();

  return (
    <div className="dashboard">
      <aside className="dashboard__sidebar">
        <div className="dashboard__logo">
          <span></span>
          <span>Chat-Go</span>
        </div>
        <nav className="dashboard__nav">
          <a className="dashboard__nav-item" href="#" onClick={(e) => { e.preventDefault(); onNavigate('dashboard'); }}>
            Inicio
          </a>
          <a className="dashboard__nav-item" href="#" onClick={(e) => { e.preventDefault(); onNavigate('users'); }}>
            Usuarios
          </a>
          <a className="dashboard__nav-item dashboard__nav-item--active" href="#" onClick={(e) => e.preventDefault()}>
            Tenants
          </a>
        </nav>
        <button className="dashboard__logout" onClick={onLogout}>
          Cerrar sesión
        </button>
      </aside>

      <main className="dashboard__main">
        <header className="dashboard__header">
          <h1 className="dashboard__page-title">Tenants</h1>
          <div className="tenants__header-actions">
            <button className="tenants__btn-refresh" onClick={refetch}> Refrescar</button>
            <button className="tenants__btn-new" onClick={() => onNavigate('new-tenant')}>
  ＋ Nuevo Bot
</button>
          </div>
        </header>

        <div className="dashboard__content">
          {loading && (
            <div className="tenants__state">
              <div className="tenants__spinner" />
              <p>Cargando tenants...</p>
            </div>
          )}

          {error && (
            <div className="tenants__state tenants__state--error">
              <span></span>
              <p>{error}</p>
              <button className="tenants__btn-refresh" onClick={refetch}>Reintentar</button>
            </div>
          )}

          {!loading && !error && tenants.length === 0 && (
            <div className="tenants__empty">
              <div className="tenants__empty-icon">🤖</div>
              <h2>No hay ningún bot todavía</h2>
              <p>Crea tu primer bot haciendo clic en "Nuevo Bot".</p>
              <button className="tenants__btn-new" onClick={() => onNavigate('new-tenant')}>
  ＋ Nuevo Bot
</button>
            </div>
          )}

          {!loading && !error && tenants.length > 0 && (
            <div className="tenants__grid">
              {tenants.map((tenant) => (
                <TenantCard key={tenant.id} tenant={tenant} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
