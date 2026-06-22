import { useState } from 'react';
import { authService } from '../services/authService';

interface UseLoginReturn {
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<boolean>;
}

export function useLogin(): UseLoginReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async (email: string, password: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const data = await authService.login(email, password);
      authService.saveToken(data.access_token);
      authService.saveUser(data.user);
      return true;
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión');
      return false;
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, login };
}
