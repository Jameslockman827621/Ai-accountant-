'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('CommerceIntegration');

interface CommerceConnector {
  id: string;
  provider: 'shopify' | 'stripe' | 'amazon' | 'paypal';
  connectorName: string;
  status: 'enabled' | 'disabled' | 'error';
  connectedAt: string;
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'failed';
  nextSyncAt?: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface CommerceIntegrationProps {
  token: string;
  tenantId: string;
}

export default function CommerceIntegration({ token, tenantId }: CommerceIntegrationProps) {
  const [connectors, setConnectors] = useState<CommerceConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [shopifyDomain, setShopifyDomain] = useState('');
  const [stripeApiKey, setStripeApiKey] = useState('');

  useEffect(() => {
    loadConnectors();
    const interval = setInterval(loadConnectors, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadConnectors = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/commerce/connectors`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load connectors');

      const data = await response.json();
      setConnectors(data.connectors || []);
    } catch (error) {
      logger.error('Failed to load commerce connectors', error);
    } finally {
      setLoading(false);
    }
  };

  const connectShopify = async () => {
    if (!shopifyDomain) {
      alert('Please enter your Shopify store domain');
      return;
    }

    setConnecting('shopify');
    try {
      // In production, would initiate OAuth flow
      // For now, simulate connection
      const response = await fetch(`${API_BASE}/api/commerce/shopify/connect`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          shopDomain: shopifyDomain,
          accessToken: 'mock_token', // In production, would come from OAuth
        }),
      });

      if (!response.ok) throw new Error('Connection failed');

      setShopifyDomain('');
      await loadConnectors();
    } catch (error) {
      logger.error('Failed to connect Shopify', error);
      alert('Failed to connect Shopify');
    } finally {
      setConnecting(null);
    }
  };

  const connectStripe = async () => {
    if (!stripeApiKey) {
      alert('Please enter your Stripe API key');
      return;
    }

    setConnecting('stripe');
    try {
      const response = await fetch(`${API_BASE}/api/commerce/stripe/connect`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: stripeApiKey,
        }),
      });

      if (!response.ok) throw new Error('Connection failed');

      setStripeApiKey('');
      await loadConnectors();
    } catch (error) {
      logger.error('Failed to connect Stripe', error);
      alert('Failed to connect Stripe');
    } finally {
      setConnecting(null);
    }
  };

  const syncConnector = async (connectorId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/commerce/sync/${connectorId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Commerce Integrations</h1>
        <p className="text-gray-600 mt-1">Connect your e-commerce and payment processors</p>
      </div>

      {/* Shopify */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Shopify</h3>
            <p className="text-sm text-gray-600">
              Connect your Shopify store to automatically import orders, payouts, and transactions
            </p>
          </div>
          {connectors.find(c => c.provider === 'shopify') ? (
            <StatusBadge status="enabled" />
          ) : (
            <StatusBadge status="disabled" />
          )}
        </div>

        {!connectors.find(c => c.provider === 'shopify') ? (
          <div className="space-y-3">
            <input
              type="text"
              value={shopifyDomain}
              onChange={(e) => setShopifyDomain(e.target.value)}
              placeholder="your-store.myshopify.com"
              className="w-full border border-gray-300 rounded-lg p-2"
            />
            <button
              onClick={connectShopify}
              disabled={connecting === 'shopify'}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {connecting === 'shopify' ? 'Connecting...' : 'Connect Shopify'}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">
              Connected: {new Date(connectors.find(c => c.provider === 'shopify')!.connectedAt).toLocaleDateString()}
            </span>
            <button
              onClick={() => syncConnector(connectors.find(c => c.provider === 'shopify')!.id)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Sync Now
            </button>
          </div>
        )}
      </div>

      {/* Stripe */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Stripe</h3>
            <p className="text-sm text-gray-600">
              Connect Stripe to import charges, payouts, and refunds
            </p>
          </div>
          {connectors.find(c => c.provider === 'stripe') ? (
            <StatusBadge status="enabled" />
          ) : (
            <StatusBadge status="disabled" />
          )}
        </div>

        {!connectors.find(c => c.provider === 'stripe') ? (
          <div className="space-y-3">
            <input
              type="password"
              value={stripeApiKey}
              onChange={(e) => setStripeApiKey(e.target.value)}
              placeholder="sk_live_..."
              className="w-full border border-gray-300 rounded-lg p-2"
            />
            <button
              onClick={connectStripe}
              disabled={connecting === 'stripe'}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {connecting === 'stripe' ? 'Connecting...' : 'Connect Stripe'}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">
              Connected: {new Date(connectors.find(c => c.provider === 'stripe')!.connectedAt).toLocaleDateString()}
            </span>
            <button
              onClick={() => syncConnector(connectors.find(c => c.provider === 'stripe')!.id)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Sync Now
            </button>
          </div>
        )}
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

function StatusBadge({ status }: { status: CommerceConnector['status'] }) {
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
