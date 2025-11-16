'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('IngestionDashboard');

interface IngestionStats {
  totalIngested: number;
  totalProcessed: number;
  totalFailed: number;
  bySourceType: Record<string, {
    ingested: number;
    processed: number;
    failed: number;
  }>;
  averageProcessingTime: number;
  successRate: number;
}

interface IngestionLogItem {
  id: string;
  sourceType: string;
  connectorProvider?: string;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  ingestedAt: string;
  processedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  classificationConfidence?: number;
  reconciliationStatus?: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface IngestionDashboardProps {
  token: string;
  tenantId: string;
}

export default function IngestionDashboard({ token, tenantId }: IngestionDashboardProps) {
  const [stats, setStats] = useState<IngestionStats | null>(null);
  const [log, setLog] = useState<IngestionLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'processing' | 'completed' | 'failed'>('all');
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month'>('week');

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [dateRange]);

  const loadData = async () => {
    try {
      const endDate = new Date();
      const startDate = new Date();
      
      if (dateRange === 'today') {
        startDate.setHours(0, 0, 0, 0);
      } else if (dateRange === 'week') {
        startDate.setDate(startDate.getDate() - 7);
      } else {
        startDate.setMonth(startDate.getMonth() - 1);
      }

      // Load stats
      const statsRes = await fetch(
        `${API_BASE}/api/ingestion/stats?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.stats);
      }

      // Load log
      const status = filter === 'all' ? undefined : filter;
      const logParams = new URLSearchParams();
      if (status) logParams.append('status', status);
      logParams.append('limit', '100');

      const logRes = await fetch(
        `${API_BASE}/api/ingestion/log?${logParams.toString()}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (logRes.ok) {
        const logData = await logRes.json();
        setLog(logData.log || []);
      }
    } catch (error) {
      logger.error('Failed to load ingestion data', error);
    } finally {
      setLoading(false);
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Ingestion Dashboard</h1>
          <p className="text-gray-600 mt-1">Monitor data ingestion and processing status</p>
        </div>
        <div className="flex items-center space-x-2">
          {(['today', 'week', 'month'] as const).map(range => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                dateRange === range
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {range.charAt(0).toUpperCase() + range.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard
            title="Total Ingested"
            value={stats.totalIngested.toLocaleString()}
            color="blue"
          />
          <StatCard
            title="Processed"
            value={stats.totalProcessed.toLocaleString()}
            subtitle={`${stats.successRate.toFixed(1)}% success rate`}
            color="green"
          />
          <StatCard
            title="Failed"
            value={stats.totalFailed.toLocaleString()}
            color="red"
          />
          <StatCard
            title="Avg Processing Time"
            value={`${stats.averageProcessingTime.toFixed(1)}s`}
            color="purple"
          />
        </div>
      )}

      {/* Source Type Breakdown */}
      {stats && Object.keys(stats.bySourceType).length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">By Source Type</h2>
          <div className="space-y-3">
            {Object.entries(stats.bySourceType).map(([sourceType, data]) => (
              <div key={sourceType} className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="font-medium text-gray-900 capitalize">{sourceType.replace('_', ' ')}</p>
                  <div className="mt-1 flex items-center space-x-4 text-sm text-gray-600">
                    <span>Ingested: {data.ingested}</span>
                    <span>Processed: {data.processed}</span>
                    <span className="text-red-600">Failed: {data.failed}</span>
                  </div>
                </div>
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-green-600 h-2 rounded-full"
                    style={{ width: `${(data.processed / data.ingested) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ingestion Log */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Ingestion Log</h2>
          <div className="flex items-center space-x-2">
            {(['all', 'pending', 'processing', 'completed', 'failed'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-xs font-medium ${
                  filter === f
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provider</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ingested</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Processed</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Confidence</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {log.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    No ingestion records found
                  </td>
                </tr>
              ) : (
                log.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900 capitalize">
                      {item.sourceType.replace('_', ' ')}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.connectorProvider || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <StatusBadge status={item.processingStatus} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {new Date(item.ingestedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {item.processedAt ? new Date(item.processedAt).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {item.classificationConfidence !== undefined ? (
                        <span className={`font-medium ${
                          item.classificationConfidence >= 0.9 ? 'text-green-600' :
                          item.classificationConfidence >= 0.7 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {(item.classificationConfidence * 100).toFixed(0)}%
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  color,
}: {
  title: string;
  value: string;
  subtitle?: string;
  color: 'blue' | 'green' | 'red' | 'purple';
}) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-sm font-medium opacity-80">{title}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {subtitle && <p className="text-xs mt-1 opacity-70">{subtitle}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: IngestionLogItem['processingStatus'] }) {
  const colors = {
    pending: 'bg-yellow-100 text-yellow-800',
    processing: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
