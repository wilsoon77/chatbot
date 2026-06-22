const API_URL = 'http://localhost:3000';

export interface LoginResponse {
  access_token: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
}

export const authService = {
  async login(email: string, password: string): Promise<LoginResponse> {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.message || 'Credenciales inválidas');
    }

    return res.json();
  },

  saveToken(token: string) {
    localStorage.setItem('access_token', token);
  },

  getToken(): string | null {
    return localStorage.getItem('access_token');
  },

  removeToken() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
  },

  saveUser(user: LoginResponse['user']) {
    localStorage.setItem('user', JSON.stringify(user));
  },

  getUser(): LoginResponse['user'] | null {
    const u = localStorage.getItem('user');
    return u ? JSON.parse(u) : null;
  },

  isAuthenticated(): boolean {
    return !!localStorage.getItem('access_token');
  },
};
