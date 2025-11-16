'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('BankConnectionHealth');

interface ConnectionHealth {
  connectionId: string;
  provider: 'plaid' | 'truelayer';
  status: 'healthy' | 'warning' | 'critical' | 'expired';
  lastSync: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  daysUntilExpiry: number | null;
  errorCount: number;
  recommendations: string[];
}

export default function BankConnectionHealth() {
  const [connections, setConnections] = useState<ConnectionHealth[]>([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<{
    totalConnections: number;
    healthy: number;
    warning: number;
    critical: number;
    expired: number;
  } | null>(null);

  useEffect(() => {
    loadHealth();
  }, []);

  const loadHealth = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/bank-feed/connections/attention', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load health');

      const data = await response.json();
      setConnections(data.connections || []);

      // Also get summary
      const summaryResponse = await fetch('/api/bank-feed/health-check', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (summaryResponse.ok) {
        const summaryData = await summaryResponse.json();
        setSummary(summaryData.summary);
      }
    } catch (error) {
      logger.error('Failed to load health', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-100 text-green-800';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800';
      case 'critical':
        return 'bg-red-100 text-red-800';
      case 'expired':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Bank Connection Health</h2>
          <button
            onClick={loadHealth}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {summary && (
          <div className="grid grid-cols-5 gap-4 mb-6">
            <div className="text-center p-4 bg-gray-50 rounded">
              <p className="text-2xl font-bold">{summary.totalConnections}</p>
              <p className="text-sm text-gray-600">Total</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded">
              <p className="text-2xl font-bold text-green-600">{summary.healthy}</p>
              <p className="text-sm text-gray-600">Healthy</p>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded">
              <p className="text-2xl font-bold text-yellow-600">{summary.warning}</p>
              <p className="text-sm text-gray-600">Warning</p>
            </div>
            <div className="text-center p-4 bg-orange-50 rounded">
              <p className="text-2xl font-bold text-orange-600">{summary.critical}</p>
              <p className="text-sm text-gray-600">Critical</p>
            </div>
            <div className="text-center p-4 bg-red-50 rounded">
              <p className="text-2xl font-bold text-red-600">{summary.expired}</p>
              <p className="text-sm text-gray-600">Expired</p>
            </div>
          </div>
        )}

        {loading && <p className="text-gray-500">Loading...</p>}

        {!loading && connections.length === 0 && (
          <p className="text-gray-500">All connections are healthy</p>
        )}

        {!loading && connections.length > 0 && (
          <div className="space-y-4">
            {connections.map((conn) => (
              <div
                key={conn.connectionId}
                className="border rounded-lg p-4"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(conn.status)}`}>
                        {conn.status.toUpperCase()}
                      </span>
                      <span className="text-sm font-medium">{conn.provider}</span>
                    </div>
                    {conn.lastSync && (
                      <p className="text-sm text-gray-600">
                        Last sync: {new Date(conn.lastSync).toLocaleString()}
                      </p>
                    )}
                    {conn.daysUntilExpiry !== null && (
                      <p className="text-sm text-gray-600">
                        Token expires in: {conn.daysUntilExpiry} days
                      </p>
                    )}
                    {conn.errorCount > 0 && (
                      <p className="text-sm text-red-600">
                        Errors: {conn.errorCount}
                      </p>
                    )}
                    {conn.lastError && (
                      <p className="text-sm text-red-600 mt-1">
                        Last error: {conn.lastError}
                      </p>
                    )}
                  </div>
                </div>
                {conn.recommendations.length > 0 && (
                  <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                    <p className="text-sm font-semibold mb-1">Recommendations:</p>
                    <ul className="list-disc pl-6 text-sm">
                      {conn.recommendations.map((rec, i) => (
                        <li key={i}>{rec}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
