import { useState } from 'react';
import { authService } from './features/auth/services/authService';
import { LoginPage } from './features/auth/pages/LoginPage';
import { DashboardPage } from './features/dashboard/pages/DashboardPage';
import { TenantsPage } from './features/tenants/pages/TenantsPage';
import { NewTenantPage } from './features/tenants/pages/NewTenantPage';
import { EditTenantPage } from './features/tenants/pages/EditTenantPage';
import type { Tenant } from './features/tenants/service/tenantsService';
import type { Page } from './types/navigation';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    authService.isAuthenticated()
  );

  const [page, setPage] = useState<Page>('dashboard');
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);

  const handleLogin = () => setIsAuthenticated(true);
  const handleLogout = () => setIsAuthenticated(false);

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (page === 'tenants') {
    return (
      <TenantsPage
        onLogout={handleLogout}
        onNavigate={setPage}
        onEditTenant={setEditingTenant}
      />
    );
  }

  if (page === 'new-tenant') {
    return (
      <NewTenantPage
        onLogout={handleLogout}
        onNavigate={setPage}
      />
    );
  }

  if (page === 'edit-tenant' && editingTenant) {
    return (
      <EditTenantPage
        tenant={editingTenant}
        onLogout={handleLogout}
        onNavigate={setPage}
      />
    );
  }

  if (page === 'users') {
    return <div>Users Page</div>;
  }

  return (
    <DashboardPage
      onLogout={handleLogout}
      onNavigate={setPage}
    />
  );
}

export default App;