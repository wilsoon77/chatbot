import { useState, useEffect } from 'react';

import { tenantsService, type Tenant } from '../service/tenantsService';

export function useTenants() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTenants = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await tenantsService.getAll();
      setTenants(data);
    } catch (err: any) {
      setError(err.message || 'Error al cargar tenants');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, []);

  return { tenants, loading, error, refetch: fetchTenants };
}
