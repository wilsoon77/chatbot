import { useState } from 'react';
import { authService } from './features/auth/services/authService';
import { LoginPage } from './features/auth/pages/LoginPage';
import { DashboardPage } from './features/dashboard/pages/DashboardPage';
import { TenantsPage } from './features/tenants/pages/TenantsPage';
import { NewTenantPage } from './features/tenants/pages/NewTenantPage';
import type { Page } from './types/navigation';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(
    authService.isAuthenticated()
  );

  const [page, setPage] = useState<Page>('dashboard');

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