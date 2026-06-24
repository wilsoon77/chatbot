const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface Tenant {
  id: string;
  nombre: string;
  systemPrompt: string;
  woocommerceUrl: string;
  consumerKey: string;
  consumerSecret: string;
  enabledTools: string[];
  redisTTL: number;
  createdAt: string;
  updatedAt: string;
}

export const tenantsService = {
  async getAll(): Promise<Tenant[]> {
    const token = localStorage.getItem('access_token');

    const res = await fetch(`${API_URL}/admin/tenants`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error('Error al obtener tenants');
    }

    return res.json();
  },

  async create(
    data: Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Tenant> {
    const token = localStorage.getItem('access_token');

    const res = await fetch(`${API_URL}/admin/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      throw new Error('Error al crear el tenant');
    }

    return res.json();
  },


async update(id: string, data: Record<string, unknown>): Promise<Tenant> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API_URL}/admin/tenants/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Error al actualizar el tenant');
  return res.json();
},

async delete(id: string): Promise<void> {
  const token = localStorage.getItem('access_token');
  const res = await fetch(`${API_URL}/admin/tenants/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Error al eliminar el tenant');
},


};

