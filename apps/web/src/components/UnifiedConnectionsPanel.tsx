'use client';

import { useCallback, useEffect, useState } from 'react';
import { useConnectors } from '@/hooks/useConnectors';

interface UnifiedConnectionsPanelProps {
  token: string;
  variant?: 'onboarding' | 'dashboard';
  jurisdiction?: string;
  entityType?: string;
}

type ConnectorType = 'bank' | 'accounting' | 'payroll' | 'commerce';

interface ConnectorCatalogEntry {
  id: string;
  provider: string;
  providerName: string;
  connectorType: ConnectorType;
  authType: string;
  description?: string;
  documentationUrl?: string;
  logoUrl?: string;
  category: string;
  priority: number;
}

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

export default function UnifiedConnectionsPanel({
  token,
  variant = 'dashboard',
  jurisdiction,
  entityType,
}: UnifiedConnectionsPanelProps) {
  const { connectors, isLoading, error, refresh, getCatalog, getLinkToken } = useConnectors(token);
  const [activeTab, setActiveTab] = useState<ConnectorType>('bank');
  const [catalog, setCatalog] = useState<ConnectorCatalogEntry[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  const [guidedModalOpen, setGuidedModalOpen] = useState(false);
  const [guidedStep, setGuidedStep] = useState(0);

  useEffect(() => {
    refresh();
    loadCatalog();
  }, [refresh]);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    try {
      const catalogData = await getCatalog(jurisdiction, entityType, activeTab);
      setCatalog(catalogData);
    } catch (err) {
      console.error('Failed to load catalog', err);
    } finally {
      setLoadingCatalog(false);
    }
  }, [getCatalog, jurisdiction, entityType, activeTab]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const handleConnect = useCallback(async (provider: string) => {
    setConnectingProvider(provider);
    try {
      const linkData = await getLinkToken(provider);
      
      if (linkData.authorizationUrl) {
        // Open OAuth flow
        window.location.href = linkData.authorizationUrl;
      } else if (linkData.linkToken) {
        // Handle link token (e.g., Plaid)
        // In production, this would launch Plaid Link
        console.log('Link token received:', linkData.linkToken);
        alert(`Link token received for ${provider}. Integration with Plaid Link would happen here.`);
      } else {
        alert(`Instructions: ${linkData.instructions || 'Please configure this connector manually.'}`);
      }
    } catch (err) {
      console.error('Failed to connect', err);
      alert('Failed to initiate connection. Please try again.');
    } finally {
      setConnectingProvider(null);
    }
  }, [getLinkToken]);

  const getConnectorsByType = (type: ConnectorType) => {
    return connectors.filter(c => c.connectorType === type);
  };

  const getCatalogByType = (type: ConnectorType) => {
    return catalog.filter(c => c.connectorType === type).sort((a, b) => b.priority - a.priority);
  };

  const getStatusBadge = (connector: Connector) => {
    const status = connector.status.toLowerCase();
    const health = connector.healthStatus?.toLowerCase() || 'unknown';
    
    if (status === 'enabled' && health === 'healthy') {
      return { label: 'Connected', color: 'bg-green-100 text-green-800' };
    } else if (status === 'enabled' && health === 'degraded') {
      return { label: 'Degraded', color: 'bg-yellow-100 text-yellow-800' };
    } else if (status === 'enabled' && health === 'unhealthy') {
      return { label: 'Error', color: 'bg-red-100 text-red-800' };
    } else if (status === 'pending') {
      return { label: 'Pending', color: 'bg-gray-100 text-gray-800' };
    } else {
      return { label: 'Not Connected', color: 'bg-gray-100 text-gray-800' };
    }
  };

  const variantClasses = variant === 'onboarding' ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-white';

  const tabs: Array<{ key: ConnectorType; label: string }> = [
    { key: 'bank', label: 'Bank' },
    { key: 'accounting', label: 'Accounting' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'commerce', label: 'Commerce' },
  ];

  const connectedConnectors = getConnectorsByType(activeTab);
  const availableConnectors = getCatalogByType(activeTab);

  return (
    <div className={`rounded-2xl border ${variantClasses} p-6 shadow-sm space-y-4`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Connections</h3>
          <p className="text-sm text-gray-500">
            Connect your accounts to automate data sync and reconciliation.
          </p>
        </div>
        {variant === 'dashboard' && (
          <button
            type="button"
            onClick={() => setGuidedModalOpen(true)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Guided Setup
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 border-b border-gray-200">
        {tabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading || loadingCatalog ? (
        <p className="text-sm text-gray-500">Loading connections…</p>
      ) : (
        <div className="space-y-4">
          {/* Connected Connectors */}
          {connectedConnectors.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Connected</p>
              <div className="space-y-2">
                {connectedConnectors.map(connector => {
                  const badge = getStatusBadge(connector);
                  return (
                    <div
                      key={connector.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4"
                    >
                      <div className="flex-1">
                        <div className="flex items-center space-x-3">
                          <p className="font-medium text-gray-900">{connector.connectorName}</p>
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${badge.color}`}>
                            {badge.label}
                          </span>
                          {connector.isRequired && (
                            <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">
                              Required
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">{connector.provider}</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        {connector.status === 'enabled' && (
                          <span className="text-xs text-gray-500">Auto-sync ON</span>
                        )}
                        <button
                          type="button"
                          onClick={() => refresh()}
                          className="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Available Connectors */}
          {availableConnectors.length > 0 && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                {connectedConnectors.length > 0 ? 'Add More' : 'Available Connectors'}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {availableConnectors.map(entry => {
                  const isConnected = connectedConnectors.some(c => c.provider === entry.provider);
                  const isConnecting = connectingProvider === entry.provider;

                  return (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-gray-200 bg-white p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <p className="font-medium text-gray-900">{entry.providerName}</p>
                            {entry.category === 'primary' && (
                              <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">
                                Recommended
                              </span>
                            )}
                          </div>
                          {entry.description && (
                            <p className="text-sm text-gray-500 mt-1">{entry.description}</p>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleConnect(entry.provider)}
                        disabled={isConnected || isConnecting}
                        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {isConnected
                          ? 'Connected'
                          : isConnecting
                          ? 'Connecting…'
                          : `Connect ${entry.providerName}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {connectedConnectors.length === 0 && availableConnectors.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-600">
              No connectors available for this category.
            </div>
          )}
        </div>
      )}

      {/* Guided Modal */}
      {guidedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl p-6">
            <button
              type="button"
              onClick={() => {
                setGuidedModalOpen(false);
                setGuidedStep(0);
              }}
              className="absolute right-4 top-4 rounded-full border border-gray-200 p-1 text-gray-500 hover:text-gray-700"
            >
              ×
            </button>

            <h3 className="text-xl font-semibold text-gray-900 mb-4">Guided Connector Setup</h3>

            {availableConnectors.length > 0 ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Step {guidedStep + 1} of {Math.min(availableConnectors.length, 3)}: Connect{' '}
                  {availableConnectors[guidedStep]?.providerName}
                </p>
                <p className="text-sm text-gray-500">
                  {availableConnectors[guidedStep]?.description}
                </p>
                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={() => handleConnect(availableConnectors[guidedStep]?.provider)}
                    className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    Connect Now
                  </button>
                  {guidedStep < Math.min(availableConnectors.length - 1, 2) && (
                    <button
                      type="button"
                      onClick={() => setGuidedStep(prev => prev + 1)}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Skip
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-600">No connectors available for guided setup.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
