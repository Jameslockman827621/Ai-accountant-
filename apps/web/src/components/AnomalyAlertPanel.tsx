'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('AnomalyAlertPanel');

interface Anomaly {
  id: string;
  type: 'unusual_amount' | 'duplicate' | 'missing_data' | 'tax_mismatch' | 'date_anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  documentId?: string;
  transactionId?: string;
  detectedAt: string;
  resolved: boolean;
  suggestedAction?: string;
}

interface AnomalyAlertPanelProps {
  token: string;
  onAnomalyClick?: (anomaly: Anomaly) => void;
}

export default function AnomalyAlertPanel({ token, onAnomalyClick }: AnomalyAlertPanelProps) {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'critical'>('unresolved');

  useEffect(() => {
    loadAnomalies();
    const interval = setInterval(loadAnomalies, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [filter]);

  const loadAnomalies = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/validation/anomalies?filter=${filter}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load anomalies');

      const data = await response.json();
      setAnomalies(data.anomalies || []);
    } catch (error) {
      logger.error('Failed to load anomalies', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsResolved = async (anomalyId: string) => {
    try {
      const response = await fetch(`/api/validation/anomalies/${anomalyId}/resolve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to resolve anomaly');

      setAnomalies(prev => prev.map(a => a.id === anomalyId ? { ...a, resolved: true } : a));
    } catch (error) {
      logger.error('Failed to resolve anomaly', error);
      alert('Failed to mark anomaly as resolved');
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 border-red-500 text-red-800';
      case 'high':
        return 'bg-orange-100 border-orange-500 text-orange-800';
      case 'medium':
        return 'bg-yellow-100 border-yellow-500 text-yellow-800';
      default:
        return 'bg-blue-100 border-blue-500 text-blue-800';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'unusual_amount':
        return '💰';
      case 'duplicate':
        return '📋';
      case 'missing_data':
        return '⚠️';
      case 'tax_mismatch':
        return '📊';
      case 'date_anomaly':
        return '📅';
      default:
        return '🔍';
    }
  };

  const criticalCount = anomalies.filter(a => a.severity === 'critical' && !a.resolved).length;
  const unresolvedCount = anomalies.filter(a => !a.resolved).length;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold">Anomaly Alerts</h2>
          {unresolvedCount > 0 && (
            <p className="text-sm text-gray-600 mt-1">
              {unresolvedCount} unresolved {criticalCount > 0 && `(${criticalCount} critical)`}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="all">All</option>
            <option value="unresolved">Unresolved</option>
            <option value="critical">Critical Only</option>
          </select>
          <button
            onClick={loadAnomalies}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && anomalies.length === 0 ? (
        <div className="text-center py-8 text-gray-500">Loading anomalies...</div>
      ) : anomalies.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p className="text-lg">✅ No anomalies detected</p>
          <p className="text-sm mt-2">Your data looks good!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {anomalies.map((anomaly) => (
            <div
              key={anomaly.id}
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                anomaly.resolved
                  ? 'bg-gray-50 border-gray-200 opacity-60'
                  : getSeverityColor(anomaly.severity)
              }`}
              onClick={() => onAnomalyClick && onAnomalyClick(anomaly)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <span className="text-2xl">{getTypeIcon(anomaly.type)}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{anomaly.title}</h3>
                      <span className={`text-xs px-2 py-1 rounded ${
                        anomaly.severity === 'critical' ? 'bg-red-200 text-red-900' :
                        anomaly.severity === 'high' ? 'bg-orange-200 text-orange-900' :
                        anomaly.severity === 'medium' ? 'bg-yellow-200 text-yellow-900' :
                        'bg-blue-200 text-blue-900'
                      }`}>
                        {anomaly.severity.toUpperCase()}
                      </span>
                      {anomaly.resolved && (
                        <span className="text-xs px-2 py-1 bg-green-200 text-green-900 rounded">
                          RESOLVED
                        </span>
                      )}
                    </div>
                    <p className="text-sm mb-2">{anomaly.description}</p>
                    {anomaly.suggestedAction && (
                      <p className="text-xs italic text-gray-700 mb-2">
                        💡 {anomaly.suggestedAction}
                      </p>
                    )}
                    <p className="text-xs text-gray-600">
                      Detected: {new Date(anomaly.detectedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                {!anomaly.resolved && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      markAsResolved(anomaly.id);
                    }}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Mark Resolved
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
