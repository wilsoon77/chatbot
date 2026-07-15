const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ─── Tipos de conector ────────────────────────────────────────────────────

export type ConnectorType = 'WOOCOMMERCE' | 'ODOO' | 'DIRECT_DATABASE';

export const CONNECTOR_LABELS: Record<ConnectorType, string> = {
  WOOCOMMERCE: 'WooCommerce (API REST)',
  DIRECT_DATABASE: 'Base de datos directa (PostgreSQL / MySQL)',
  ODOO: 'Odoo',
};

// ─── Credenciales por tipo de conector ─────────────────────────────────────

export interface WooCommerceCredentials {
  url: string;
  consumerKey: string;
  consumerSecret: string;
  currency?: string;
}

export interface DatabaseCredentials {
  driver: 'postgresql' | 'mysql';
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  currency?: string;
  tableMapping?: TableMapping;
}

export interface TableMapping {
  products: string;
  categories: string;
  orders: string;
  orderItems: string;
  product: {
    id: string; name: string; price: string; stock: string;
    stockStatus?: string; sku?: string; description?: string;
    image?: string; url?: string; categoryId?: string;
  };
  category: { id: string; name: string; count?: string };
  order: { id: string; status: string; total: string; date: string; email?: string };
  orderItem: { orderId: string; productName: string; quantity: string; price: string };
}

export type ConnectorCredentials =
  | WooCommerceCredentials
  | DatabaseCredentials
  | Record<string, any>;

// ─── Tenant ────────────────────────────────────────────────────────────────

export interface Tenant {
  id: string;
  nombre: string;
  systemPrompt: string;
  connectorType: ConnectorType;
  connectorCredentials: Record<string, any>;
  enabledTools: string[];
  redisTTL: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Payload para crear ─────────────────────────────────────────────────────

export interface CreateTenantPayload {
  nombre: string;
  systemPrompt: string;
  connectorType: ConnectorType;
  connectorCredentials: ConnectorCredentials;
  enabledTools: string[];
  redisTTL?: number;
}

export interface UpdateTenantPayload {
  nombre?: string;
  systemPrompt?: string;
  connectorType?: ConnectorType;
  connectorCredentials?: ConnectorCredentials;
  enabledTools?: string[];
  redisTTL?: number;
}

// ─── Servicio ──────────────────────────────────────────────────────────────

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

  async create(data: CreateTenantPayload): Promise<Tenant> {
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
      const err = await res.json().catch(() => null);
      throw new Error(err?.message || 'Error al crear el tenant');
    }

    return res.json();
  },

  async update(id: string, data: UpdateTenantPayload): Promise<Tenant> {
    const token = localStorage.getItem('access_token');
    const res = await fetch(`${API_URL}/admin/tenants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.message || 'Error al actualizar el tenant');
    }
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

