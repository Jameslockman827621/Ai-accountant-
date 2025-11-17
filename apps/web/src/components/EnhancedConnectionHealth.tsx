'use client';

import React, { useState, useEffect } from 'react';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ClockIcon,
} from '@heroicons/react/24/outline';

interface Connection {
  id: string;
  provider: 'plaid' | 'truelayer' | 'gocardless' | 'nordigen';
  name: string;
  status: 'healthy' | 'warning' | 'critical' | 'expired';
  lastSync: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  nextSync: string | null;
  syncFrequency: string;
  transactionCount: number;
  failureRate: number;
}

interface WebhookConnection {
  id: string;
  provider: 'shopify' | 'stripe' | 'plaid' | 'truelayer';
  endpoint: string;
  status: 'active' | 'inactive' | 'error';
  lastReceived: string | null;
  lastError: string | null;
  requestCount: number;
}

export default function EnhancedConnectionHealth() {
  const [bankConnections, setBankConnections] = useState<Connection[]>([]);
  const [webhookConnections, setWebhookConnections] = useState<WebhookConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'bank' | 'webhook'>('bank');

  useEffect(() => {
    loadConnections();
    // Refresh every 30 seconds
    const interval = setInterval(loadConnections, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadConnections = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');

      // Load bank connections
      const bankResponse = await fetch('/api/bank-feed/connections/health', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (bankResponse.ok) {
        const bankData = await bankResponse.json();
        setBankConnections(bankData.connections || []);
      }

      // Load webhook connections
      const webhookResponse = await fetch('/api/webhooks/connections', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (webhookResponse.ok) {
        const webhookData = await webhookResponse.json();
        setWebhookConnections(webhookData.connections || []);
      }
    } catch (error) {
      console.error('Failed to load connections', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshConnection = async (connectionId: string, type: 'bank' | 'webhook') => {
    try {
      const token = localStorage.getItem('authToken');
      const endpoint =
        type === 'bank'
          ? `/api/bank-feed/connections/${connectionId}/sync`
          : `/api/webhooks/connections/${connectionId}/test`;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        await loadConnections();
      }
    } catch (error) {
      console.error('Failed to refresh connection', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'active':
        return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
      case 'warning':
        return <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />;
      case 'critical':
      case 'error':
        return <XCircleIcon className="h-5 w-5 text-red-500" />;
      case 'expired':
      case 'inactive':
        return <ClockIcon className="h-5 w-5 text-gray-500" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800';
      case 'critical':
      case 'error':
        return 'bg-red-100 text-red-800';
      case 'expired':
      case 'inactive':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatTimeAgo = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getHealthSummary = () => {
    const bankHealthy = bankConnections.filter((c) => c.status === 'healthy').length;
    const bankTotal = bankConnections.length;
    const webhookActive = webhookConnections.filter((c) => c.status === 'active').length;
    const webhookTotal = webhookConnections.length;

    return {
      bank: { healthy: bankHealthy, total: bankTotal },
      webhook: { active: webhookActive, total: webhookTotal },
    };
  };

  const summary = getHealthSummary();

  return (
    <div className="w-full max-w-7xl mx-auto p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Connection Health</h2>
        <p className="text-gray-600">
          Monitor bank feeds and webhook connections with real-time status and sync information
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Bank Feeds</h3>
            {getStatusIcon(
              summary.bank.healthy === summary.bank.total ? 'healthy' : 'warning'
            )}
          </div>
          <div className="text-3xl font-bold text-gray-900 mb-1">
            {summary.bank.healthy} / {summary.bank.total}
          </div>
          <p className="text-sm text-gray-500">Healthy connections</p>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Webhooks</h3>
            {getStatusIcon(
              summary.webhook.active === summary.webhook.total ? 'active' : 'warning'
            )}
          </div>
          <div className="text-3xl font-bold text-gray-900 mb-1">
            {summary.webhook.active} / {summary.webhook.total}
          </div>
          <p className="text-sm text-gray-500">Active connections</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4">
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setSelectedTab('bank')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                selectedTab === 'bank'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Bank Feeds ({bankConnections.length})
            </button>
            <button
              onClick={() => setSelectedTab('webhook')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                selectedTab === 'webhook'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              Webhooks ({webhookConnections.length})
            </button>
          </nav>
        </div>
      </div>

      {/* Connection List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : selectedTab === 'bank' ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Connection
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Sync
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Next Sync
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Transactions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {bankConnections.map((connection) => (
                <tr key={connection.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-blue-100">
                        <span className="text-sm font-medium text-blue-600">
                          {connection.provider.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{connection.name}</div>
                        <div className="text-sm text-gray-500">{connection.provider}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(connection.status)}
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(
                          connection.status
                        )}`}
                      >
                        {connection.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatTimeAgo(connection.lastSync)}
                    {connection.lastError && (
                      <div className="text-xs text-red-600 mt-1">{connection.lastError}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {connection.nextSync ? formatTimeAgo(connection.nextSync) : 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {connection.transactionCount.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button
                      onClick={() => refreshConnection(connection.id, 'bank')}
                      className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                    >
                      <ArrowPathIcon className="h-4 w-4" />
                      Sync Now
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Webhook
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Received
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Requests
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {webhookConnections.map((connection) => (
                <tr key={connection.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{connection.provider}</div>
                      <div className="text-sm text-gray-500">{connection.endpoint}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(connection.status)}
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded ${getStatusColor(
                          connection.status
                        )}`}
                      >
                        {connection.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatTimeAgo(connection.lastReceived)}
                    {connection.lastError && (
                      <div className="text-xs text-red-600 mt-1">{connection.lastError}</div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {connection.requestCount.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button
                      onClick={() => refreshConnection(connection.id, 'webhook')}
                      className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                    >
                      <ArrowPathIcon className="h-4 w-4" />
                      Test
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
