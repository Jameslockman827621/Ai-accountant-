'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  ExclamationTriangleIcon,
  ChartBarIcon,
  ArrowTrendingUpIcon,
  ArrowTrendingDownIcon,
  DocumentMagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

interface Anomaly {
  id: string;
  type: 'unusual_spend' | 'duplicate' | 'missing_document' | 'pattern_anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  description: string;
  transactionId?: string;
  documentId?: string;
  ledgerEntryId?: string;
  suggestedActions: string[];
  createdAt: string;
}

interface VarianceAlert {
  id: string;
  alertType: string;
  accountCode?: string;
  thresholdAmount?: number;
  actualAmount?: number;
  varianceAmount?: number;
  variancePercentage?: number;
  severity: string;
  status: string;
  createdAt: string;
}

interface AnomalyStats {
  total: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
  avgScore: number;
}

interface AnomalyDashboardProps {
  token: string;
  startDate?: Date;
  endDate?: Date;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function AnomalyDashboard({
  token,
  startDate,
  endDate,
}: AnomalyDashboardProps) {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [varianceAlerts, setVarianceAlerts] = useState<VarianceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [startDate, endDate]);

  async function fetchData() {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate.toISOString());
      if (endDate) params.append('endDate', endDate.toISOString());

      const [anomaliesRes, varianceRes] = await Promise.all([
        fetch(`${API_BASE}/api/reconciliation/anomalies?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/api/ledger/variance-alerts?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!anomaliesRes.ok) throw new Error(`Anomalies request failed (${anomaliesRes.status})`);
      if (!varianceRes.ok) throw new Error(`Variance alerts request failed (${varianceRes.status})`);

      const anomaliesData = await anomaliesRes.json() as { anomalies: Anomaly[] };
      const varianceData = await varianceRes.json() as { alerts: VarianceAlert[] };

      setAnomalies(anomaliesData.anomalies || []);
      setVarianceAlerts(varianceData.alerts || []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load anomaly data');
    } finally {
      setLoading(false);
    }
  }

  const stats = useMemo((): AnomalyStats => {
    const total = anomalies.length;
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let totalScore = 0;

    anomalies.forEach((a) => {
      byType[a.type] = (byType[a.type] || 0) + 1;
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
      totalScore += a.score;
    });

    return {
      total,
      byType,
      bySeverity,
      avgScore: total > 0 ? totalScore / total : 0,
    };
  }, [anomalies]);

  const filteredAnomalies = useMemo(() => {
    let filtered = anomalies;

    if (filter !== 'all') {
      filtered = filtered.filter((a) => a.severity === filter);
    }

    if (typeFilter !== 'all') {
      filtered = filtered.filter((a) => a.type === typeFilter);
    }

    return filtered.sort((a, b) => b.score - a.score);
  }, [anomalies, filter, typeFilter]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-600 text-white';
      case 'high':
        return 'bg-orange-600 text-white';
      case 'medium':
        return 'bg-yellow-600 text-white';
      case 'low':
        return 'bg-blue-600 text-white';
      default:
        return 'bg-gray-600 text-white';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'unusual_spend':
        return <ArrowTrendingUpIcon className="h-5 w-5" />;
      case 'duplicate':
        return <DocumentMagnifyingGlassIcon className="h-5 w-5" />;
      case 'missing_document':
        return <DocumentMagnifyingGlassIcon className="h-5 w-5" />;
      default:
        return <ExclamationTriangleIcon className="h-5 w-5" />;
    }
  };

  if (loading && anomalies.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-4 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Total Anomalies</div>
          <div className="text-2xl font-bold mt-1">{stats.total}</div>
          <div className="text-xs text-gray-400 mt-1">Avg Score: {stats.avgScore.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Critical</div>
          <div className="text-2xl font-bold text-red-600 mt-1">
            {stats.bySeverity.critical || 0}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">High</div>
          <div className="text-2xl font-bold text-orange-600 mt-1">
            {stats.bySeverity.high || 0}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Variance Alerts</div>
          <div className="text-2xl font-bold text-yellow-600 mt-1">{varianceAlerts.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Severity</label>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All</option>
              <option value="unusual_spend">Unusual Spend</option>
              <option value="duplicate">Duplicate</option>
              <option value="missing_document">Missing Document</option>
              <option value="pattern_anomaly">Pattern Anomaly</option>
            </select>
          </div>
        </div>
      </div>

      {/* Heatmap Visualization (Conceptual) */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Anomaly Distribution</h3>
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(stats.byType).map(([type, count]) => (
            <div key={type} className="text-center">
              <div className="text-2xl font-bold">{count}</div>
              <div className="text-xs text-gray-500 mt-1">
                {type.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Variance Analysis */}
      {varianceAlerts.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold">Variance Alerts</h3>
          </div>
          <div className="divide-y divide-gray-200">
            {varianceAlerts.map((alert) => (
              <div key={alert.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getSeverityColor(alert.severity)}`}>
                        {alert.severity.toUpperCase()}
                      </span>
                      <span className="text-sm text-gray-600">{alert.alertType.replace('_', ' ')}</span>
                    </div>
                    {alert.accountCode && (
                      <div className="text-sm text-gray-700">Account: {alert.accountCode}</div>
                    )}
                    {alert.actualAmount !== undefined && alert.thresholdAmount !== undefined && (
                      <div className="mt-2">
                        <div className="text-sm">
                          Actual: {alert.actualAmount.toLocaleString('en-GB', {
                            style: 'currency',
                            currency: 'GBP',
                          })}
                        </div>
                        <div className="text-sm text-gray-600">
                          Threshold: {alert.thresholdAmount.toLocaleString('en-GB', {
                            style: 'currency',
                            currency: 'GBP',
                          })}
                        </div>
                        {alert.varianceAmount !== undefined && (
                          <div className={`text-sm font-medium mt-1 ${
                            alert.varianceAmount > 0 ? 'text-red-600' : 'text-green-600'
                          }`}>
                            Variance: {alert.varianceAmount > 0 ? '+' : ''}
                            {alert.varianceAmount.toLocaleString('en-GB', {
                              style: 'currency',
                              currency: 'GBP',
                            })}
                            {alert.variancePercentage !== undefined && (
                              <span> ({alert.variancePercentage > 0 ? '+' : ''}
                                {alert.variancePercentage.toFixed(1)}%)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(alert.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Anomalies List */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Detected Anomalies</h3>
        </div>
        <div className="divide-y divide-gray-200">
          {filteredAnomalies.map((anomaly) => (
            <div key={anomaly.id} className="p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={getSeverityColor(anomaly.severity) + ' p-1 rounded'}>
                      {getTypeIcon(anomaly.type)}
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getSeverityColor(anomaly.severity)}`}>
                      {anomaly.severity.toUpperCase()}
                    </span>
                    <span className="text-sm text-gray-600">
                      {anomaly.type.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </span>
                    <span className="text-xs text-gray-500">
                      Score: {(anomaly.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="text-sm text-gray-700 mb-2">{anomaly.description}</div>
                  {anomaly.suggestedActions.length > 0 && (
                    <div className="mt-2">
                      <div className="text-xs font-medium text-gray-600 mb-1">Suggested Actions:</div>
                      <ul className="list-disc list-inside text-xs text-gray-600 space-y-1">
                        {anomaly.suggestedActions.map((action, idx) => (
                          <li key={idx}>{action}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-500 ml-4">
                  {new Date(anomaly.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
        {filteredAnomalies.length === 0 && (
          <div className="p-8 text-center text-gray-500">No anomalies found</div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">{error}</div>
      )}
    </div>
  );
}
