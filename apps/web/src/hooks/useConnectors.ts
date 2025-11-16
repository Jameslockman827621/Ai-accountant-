'use client';

import { useState, useCallback, useEffect } from 'react';

interface Connector {
  id: string;
  connectorType: string;
  provider: string;
  connectorName: string;
  status: string;
  isRequired: boolean;
  isEnabled: boolean;
  connectionId?: string;
  healthStatus?: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export function useConnectors(token: string | null) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchConnectors = useCallback(async () => {
    if (!token) {
      setConnectors([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/connectors`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load connectors');
      }

      const data = await response.json();
      setConnectors(data.connectors || []);
    } catch (err) {
      console.error('Failed to fetch connectors', err);
      setError('Unable to load connectors');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchConnectors();
  }, [fetchConnectors]);

  const registerConnector = useCallback(
    async (config: {
      connectorType: string;
      provider: string;
      connectorName: string;
      isRequired?: boolean;
    }) => {
      if (!token) {
        throw new Error('Missing authentication token');
      }

      const response = await fetch(`${API_BASE}/api/connectors`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        throw new Error('Failed to register connector');
      }

      const data = await response.json();
      await fetchConnectors();
      return data.connectorId;
    },
    [token, fetchConnectors]
  );

  const initiateConnection = useCallback(
    async (connectorId: string) => {
      if (!token) {
        throw new Error('Missing authentication token');
      }

      const response = await fetch(`${API_BASE}/api/connectors/${connectorId}/connect`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error('Failed to initiate connection');
      }

      const data = await response.json();
      return data;
    },
    [token]
  );

  const getCatalog = useCallback(
    async (jurisdiction?: string, entityType?: string, connectorType?: string) => {
      if (!token) {
        return [];
      }

      try {
        const params = new URLSearchParams();
        if (jurisdiction) params.append('jurisdiction', jurisdiction);
        if (entityType) params.append('entityType', entityType);
        if (connectorType) params.append('connectorType', connectorType);

        const response = await fetch(`${API_BASE}/api/connectors/catalog?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to load connector catalog');
        }

        const data = await response.json();
        return data.catalog || [];
      } catch (err) {
        console.error('Failed to fetch connector catalog', err);
        return [];
      }
    },
    [token]
  );

  const getLinkToken = useCallback(
    async (provider: string) => {
      if (!token) {
        throw new Error('Missing authentication token');
      }

      const response = await fetch(`${API_BASE}/api/connectors/${provider}/link-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to get link token');
      }

      const data = await response.json();
      return data;
    },
    [token]
  );

  return {
    connectors,
    isLoading,
    error,
    refresh: fetchConnectors,
    registerConnector,
    initiateConnection,
    getCatalog,
    getLinkToken,
  };
}
