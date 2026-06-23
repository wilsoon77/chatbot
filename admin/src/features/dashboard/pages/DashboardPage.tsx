import { authService } from '../../auth/services/authService';
import './DashboardPage.css';
import logo from '../../../assets/images/chatgo.png';
import type { Page } from '../../../types/navigation';

interface DashboardPageProps {
  onLogout: () => void;
  onNavigate: (page: Page) => void;
}

export function DashboardPage({ onLogout, onNavigate }: DashboardPageProps) {
  const user = authService.getUser();

  const handleLogout = () => {
    authService.removeToken();
    onLogout();
  };

  return (
    <div className="dashboard">

      <aside className="dashboard__sidebar">

        <div className="dashboard__logo">
          <img src={logo} alt="ChatGo Logo" />
          <span>Chat-Go</span>
        </div>

        <nav className="dashboard__nav">
          <a className="dashboard__nav-item dashboard__nav-item--active" href="#">
            Inicio
          </a>
          <a className="dashboard__nav-item" href="#">
            Usuarios
          </a>
          <a
            className="dashboard__nav-item"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('tenants');
            }}
          >
            Tenants
          </a>
        </nav>

        <button className="dashboard__logout" onClick={handleLogout}>
          Cerrar sesión
        </button>
      </aside>

      <main className="dashboard__main">

        <header className="dashboard__header">
          <h1 className="dashboard__page-title">Inicio</h1>

          <div className="dashboard__user">
            <span className="dashboard__user-avatar">
              {user?.email?.charAt(0).toUpperCase()}
            </span>
            <span className="dashboard__user-email">{user?.email}</span>
          </div>
        </header>

        <div className="dashboard__content">

          <div className="dashboard__welcome">
            <h2>Bienvenido al panel</h2>
            <p>Selecciona una opción del menú para comenzar.</p>
          </div>

          <div className="dashboard__cards">

            <div className="dashboard__card">
              <span className="dashboard__card-icon"></span>
              <h3>Usuarios</h3>
              <p>Gestiona los usuarios del sistema</p>
            </div>

            <div
              className="dashboard__card"
              onClick={() => onNavigate('tenants')}
            >
              <span className="dashboard__card-icon"></span>
              <h3>Tenants</h3>
              <p>Administra los tenants del chatbot</p>
            </div>

            <div className="dashboard__card">
              <span className="dashboard__card-icon"></span>
              <h3>Chats</h3>
              <p>Revisa las conversaciones activas</p>
            </div>

          </div>
        </div>

      </main>
    </div>
  );
}