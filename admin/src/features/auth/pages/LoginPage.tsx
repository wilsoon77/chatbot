import { LoginForm } from '../components/LoginForm';
import './LoginPage.css';
import logo from '../../../assets/images/chatgo.png';


interface LoginPageProps {
  onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  return (
    <div className="login-page">

      {/* Panel izquierdo — Logo */}
      <div className="login-page__brand">
        <div className="login-page__brand-inner">

          <div className="login-page__logo">
            <img
              src={logo}
              alt="Logo"
              className="login-page__logo-image"
            />
          </div>

        </div>
      </div>

      {/* Panel derecho — Formulario */}
      <div className="login-page__form-panel">
        <div className="login-page__card">
          <div className="login-page__card-header">
            <h1 className="login-page__title">Iniciar sesión</h1>
            <p className="login-page__subtitle">
              Ingresa tus credenciales para continuar
            </p>
          </div>

          <LoginForm onSuccess={onLogin} />
        </div>
      </div>

    </div>
  );
}