import { useState } from 'react';
import { useLogin } from '../hooks/useLogin';

interface LoginFormProps {
  onSuccess: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { loading, error, login } = useLogin();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await login(email, password);
    if (ok) onSuccess();
  };

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <div className="login-form__field">
        <label className="login-form__label" htmlFor="email">
          Correo electrónico
        </label>
        <input
          id="email"
          className="login-form__input"
          type="email"
          placeholder="admin@ejemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </div>

      <div className="login-form__field">
        <label className="login-form__label" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          className="login-form__input"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />
      </div>

      {error && (
        <p className="login-form__error">{error}</p>
      )}

      <button
        className="login-form__btn"
        type="submit"
        disabled={loading}
      >
        {loading ? 'Ingresando...' : 'Ingresar'}
      </button>
    </form>
  );
}
