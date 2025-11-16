'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('PayrollIntegration');

interface PayrollConnector {
  id: string;
  provider: 'gusto' | 'quickbooks_payroll' | 'adp';
  connectorName: string;
  status: 'enabled' | 'disabled' | 'error';
  connectedAt: string;
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'failed';
  nextSyncAt?: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface PayrollIntegrationProps {
  token: string;
  tenantId: string;
}

export default function PayrollIntegration({ token, tenantId }: PayrollIntegrationProps) {
  const [connectors, setConnectors] = useState<PayrollConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);

  useEffect(() => {
    loadConnectors();
    const interval = setInterval(loadConnectors, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadConnectors = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/payroll/connectors`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load connectors');

      const data = await response.json();
      setConnectors(data.connectors || []);
    } catch (error) {
      logger.error('Failed to load payroll connectors', error);
    } finally {
      setLoading(false);
    }
  };

  const connectGusto = async () => {
    setConnecting('gusto');
    try {
      const response = await fetch(`${API_BASE}/api/payroll/gusto/authorize`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to get authorization URL');

      const data = await response.json();
      window.location.href = data.authorizationUrl;
    } catch (error) {
      logger.error('Failed to connect Gusto', error);
      alert('Failed to initiate Gusto connection');
      setConnecting(null);
    }
  };

  const connectQuickBooks = async () => {
    setConnecting('quickbooks');
    // Similar to Gusto
    alert('QuickBooks Payroll connection coming soon');
    setConnecting(null);
  };

  const connectADP = async () => {
    setConnecting('adp');
    // Similar to Gusto
    alert('ADP connection coming soon');
    setConnecting(null);
  };

  const syncConnector = async (connectorId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/payroll/sync/${connectorId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date().toISOString(),
        }),
      });

      if (!response.ok) throw new Error('Sync failed');

      alert('Sync initiated successfully');
      await loadConnectors();
    } catch (error) {
      logger.error('Failed to sync connector', error);
      alert('Failed to sync connector');
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  const providers = [
    {
      id: 'gusto',
      name: 'Gusto',
      description: 'Connect your Gusto payroll account to automatically import payroll runs, employees, and liabilities',
      icon: '💰',
      connect: connectGusto,
    },
    {
      id: 'quickbooks',
      name: 'QuickBooks Payroll',
      description: 'Sync QuickBooks Payroll data including pay stubs and tax remittances',
      icon: '📊',
      connect: connectQuickBooks,
    },
    {
      id: 'adp',
      name: 'ADP',
      description: 'Import payroll data from ADP Workforce Now',
      icon: '🏢',
      connect: connectADP,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Payroll Integrations</h1>
        <p className="text-gray-600 mt-1">Connect your payroll providers to automatically import payroll data</p>
      </div>

      {/* Available Providers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {providers.map(provider => {
          const existingConnector = connectors.find(c => c.provider === provider.id);
          const isConnecting = connecting === provider.id;

          return (
            <div
              key={provider.id}
              className="rounded-lg border border-gray-200 bg-white p-6"
            >
              <div className="text-4xl mb-4">{provider.icon}</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{provider.name}</h3>
              <p className="text-sm text-gray-600 mb-4">{provider.description}</p>

              {existingConnector ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <StatusBadge status={existingConnector.status} />
                    {existingConnector.lastSyncAt && (
                      <span className="text-xs text-gray-500">
                        Last sync: {new Date(existingConnector.lastSyncAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => syncConnector(existingConnector.id)}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Sync Now
                  </button>
                </div>
              ) : (
                <button
                  onClick={provider.connect}
                  disabled={isConnecting}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Connected Connectors */}
      {connectors.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Connected Accounts</h2>
          <div className="space-y-3">
            {connectors.map(connector => (
              <div
                key={connector.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{connector.connectorName}</p>
                  <div className="flex items-center space-x-4 mt-1 text-sm text-gray-500">
                    <span>Connected: {new Date(connector.connectedAt).toLocaleDateString()}</span>
                    {connector.lastSyncAt && (
                      <span>Last sync: {new Date(connector.lastSyncAt).toLocaleString()}</span>
                    )}
                    {connector.nextSyncAt && (
                      <span>Next sync: {new Date(connector.nextSyncAt).toLocaleString()}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <StatusBadge status={connector.status} />
                  <button
                    onClick={() => syncConnector(connector.id)}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Sync
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PayrollConnector['status'] }) {
  const colors = {
    enabled: 'bg-green-100 text-green-800',
    disabled: 'bg-gray-100 text-gray-800',
    error: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
