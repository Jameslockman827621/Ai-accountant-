'use client';

import { useState, useEffect } from 'react';

interface ConnectorAuthorizationProps {
  token: string;
  connectorType: 'bank' | 'tax_authority' | 'accounting_software' | 'ecommerce' | 'payment_processor';
  provider: 'plaid' | 'truelayer' | 'hmrc' | 'irs' | 'cra' | 'shopify' | 'stripe';
  connectorName: string;
  isRequired?: boolean;
  onConnected?: (connectionId: string) => void;
  onError?: (error: string) => void;
}

type ConnectionStatus = 'pending' | 'connecting' | 'connected' | 'error' | 'disconnected';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function ConnectorAuthorization({
  token,
  connectorType,
  provider,
  connectorName,
  isRequired = false,
  onConnected,
  onError,
}: ConnectorAuthorizationProps) {
  const [status, setStatus] = useState<ConnectionStatus>('pending');
  const [connectorId, setConnectorId] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for existing connector
    checkExistingConnector();
  }, [connectorType, provider]);

  const checkExistingConnector = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/connectors`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        const existing = data.connectors?.find(
          (c: any) => c.connectorType === connectorType && c.provider === provider
        );

        if (existing) {
          setConnectorId(existing.id);
          if (existing.status === 'enabled' && existing.connectionId) {
            setStatus('connected');
            setConnectionId(existing.connectionId);
          } else if (existing.status === 'pending') {
            setStatus('pending');
          }
        }
      }
    } catch (error) {
      console.error('Failed to check connector', error);
    }
  };

  const registerConnector = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/connectors`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connectorType,
          provider,
          connectorName,
          isRequired,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to register connector');
      }

      const data = await response.json();
      setConnectorId(data.connectorId);
      return data.connectorId;
    } catch (error) {
      console.error('Connector registration failed', error);
      setError('Failed to register connector');
      onError?.('Failed to register connector');
      throw error;
    }
  };

  const initiateConnection = async () => {
    try {
      setStatus('connecting');
      setError(null);

      let id = connectorId;
      if (!id) {
        id = await registerConnector();
      }
      if (!id) {
        throw new Error('Unable to determine connector id');
      }

      const response = await fetch(`${API_BASE}/api/connectors/${id}/connect`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          authorizationData: {},
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to initiate connection');
      }

      const data = await response.json();

      if (data.authorizationUrl) {
        // OAuth flow - redirect to authorization URL
        setAuthorizationUrl(data.authorizationUrl);
        window.location.href = data.authorizationUrl;
      } else if (data.connectionId) {
        // API key flow - complete immediately
        await completeConnection(id, data.connectionId);
      }
    } catch (error) {
      console.error('Connection initiation failed', error);
      setStatus('error');
      setError('Failed to start connection');
      onError?.('Failed to start connection');
    }
  };

  const completeConnection = async (id: string, connId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/connectors/${id}/complete`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          connectionId: connId,
          accountIds: [],
        }),
      });

      if (response.ok) {
        setStatus('connected');
        setConnectionId(connId);
        onConnected?.(connId);
      }
    } catch (error) {
      console.error('Connection completion failed', error);
      setStatus('error');
      setError('Failed to complete connection');
    }
  };

  const handleDisconnect = async () => {
    if (!connectorId) return;

    try {
      const response = await fetch(`${API_BASE}/api/connectors/${connectorId}/disconnect`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        setStatus('disconnected');
        setConnectionId(null);
      }
    } catch (error) {
      console.error('Disconnect failed', error);
    }
  };

  const getProviderIcon = () => {
    const icons: Record<string, string> = {
      plaid: '🏦',
      truelayer: '💳',
      hmrc: '🇬🇧',
      irs: '🇺🇸',
      cra: '🇨🇦',
      shopify: '🛒',
      stripe: '💳',
    };
    return icons[provider] || '🔗';
  };

  const getProviderDescription = () => {
    const descriptions: Record<string, string> = {
      plaid: 'Connect your US bank accounts securely via Plaid',
      truelayer: 'Connect your UK/EU bank accounts via TrueLayer',
      hmrc: 'Authorize access to HMRC for VAT submissions',
      irs: 'Authorize access to IRS for tax filings',
      cra: 'Authorize access to CRA for Canadian tax filings',
      shopify: 'Connect your Shopify store for sales data',
      stripe: 'Connect your Stripe account for payment data',
    };
    return descriptions[provider] || 'Connect your account';
  };

  const isConnecting = status === 'connecting';

  return (
    <div className="rounded-lg border border-gray-200 p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <span className="text-3xl">{getProviderIcon()}</span>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{connectorName}</h3>
            <p className="text-sm text-gray-600">{getProviderDescription()}</p>
          </div>
        </div>
        {isRequired && (
          <span className="px-2 py-1 text-xs font-medium text-orange-600 bg-orange-50 rounded">
            Required
          </span>
        )}
      </div>

        {status === 'connected' ? (
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-green-600">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="font-medium">Connected</span>
            </div>
            {connectionId && (
              <p className="text-sm text-gray-600">Connection ID: {connectionId.substring(0, 8)}...</p>
            )}
            <button
              onClick={handleDisconnect}
              className="text-sm text-red-600 hover:text-red-700 underline"
            >
              Disconnect
            </button>
          </div>
        ) : isConnecting ? (
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-blue-600">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              <span className="font-medium">Connecting...</span>
            </div>
            <p className="text-sm text-gray-600">
              {authorizationUrl
                ? 'Redirecting to authorization page...'
                : 'Setting up connection...'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}

            <button
              onClick={initiateConnection}
              disabled={isConnecting}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isConnecting ? 'Connecting...' : `Connect ${connectorName}`}
            </button>

            <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              <p>
                <strong>Security:</strong> This connection is read-only and uses bank-level encryption.
              </p>
              <p className="mt-1">You can disconnect anytime from your settings.</p>
            </div>
          </div>
        )}
    </div>
  );
}
