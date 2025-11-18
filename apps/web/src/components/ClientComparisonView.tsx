'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ClientComparisonView');

interface ClientMetric {
  tenantId: string;
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
  profitMargin: number;
  growthRate: number;
  vatDue: number;
  upcomingDeadlines: number;
}

interface ClientComparisonViewProps {
  token: string;
  selectedClients: string[];
}

export default function ClientComparisonView({
  token,
  selectedClients,
}: ClientComparisonViewProps) {
  const [metrics, setMetrics] = useState<ClientMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<keyof ClientMetric>('revenue');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    if (selectedClients.length > 0) {
      loadMetrics();
    }
  }, [selectedClients]);

  const loadMetrics = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/accountant/clients/comparison?tenantIds=${selectedClients.join(',')}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) throw new Error('Failed to load comparison');

      const data = await response.json();
      setMetrics(data.metrics || []);
    } catch (error) {
      logger.error('Failed to load comparison', error);
    } finally {
      setLoading(false);
    }
  };

  const sortedMetrics = [...metrics].sort((a, b) => {
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    const multiplier = sortOrder === 'asc' ? 1 : -1;
    
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return (aVal - bVal) * multiplier;
    }
    return String(aVal).localeCompare(String(bVal)) * multiplier;
  });

  const handleSort = (field: keyof ClientMetric) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const getAverage = (field: keyof ClientMetric): number => {
    if (metrics.length === 0) return 0;
    const sum = metrics.reduce((acc, m) => acc + (m[field] as number), 0);
    return sum / metrics.length;
  };

  const getMax = (field: keyof ClientMetric): number => {
    return Math.max(...metrics.map(m => m[field] as number), 0);
  };

  if (selectedClients.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-500">Select clients to compare</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Client Comparison</h2>
        <button
          onClick={loadMetrics}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading comparison...</div>
      ) : (
        <>
          {/* Summary Statistics */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-gray-600">Avg Revenue</p>
              <p className="text-xl font-bold">£{getAverage('revenue').toLocaleString()}</p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <p className="text-sm text-gray-600">Avg Profit</p>
              <p className="text-xl font-bold">£{getAverage('profit').toLocaleString()}</p>
            </div>
            <div className="p-4 bg-yellow-50 rounded-lg">
              <p className="text-sm text-gray-600">Avg Margin</p>
              <p className="text-xl font-bold">{(getAverage('profitMargin') * 100).toFixed(1)}%</p>
            </div>
            <div className="p-4 bg-purple-50 rounded-lg">
              <p className="text-sm text-gray-600">Total Deadlines</p>
              <p className="text-xl font-bold">{metrics.reduce((sum, m) => sum + m.upcomingDeadlines, 0)}</p>
            </div>
          </div>

          {/* Comparison Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('name')}
                  >
                    Client {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('revenue')}
                  >
                    Revenue {sortBy === 'revenue' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('expenses')}
                  >
                    Expenses {sortBy === 'expenses' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('profit')}
                  >
                    Profit {sortBy === 'profit' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('profitMargin')}
                  >
                    Margin {sortBy === 'profitMargin' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('growthRate')}
                  >
                    Growth {sortBy === 'growthRate' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('vatDue')}
                  >
                    VAT Due {sortBy === 'vatDue' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('upcomingDeadlines')}
                  >
                    Deadlines {sortBy === 'upcomingDeadlines' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedMetrics.map((metric) => {
                  const revenuePercent = getMax('revenue') > 0 ? (metric.revenue / getMax('revenue')) * 100 : 0;
                  const profitPercent = getMax('profit') > 0 ? (metric.profit / getMax('profit')) * 100 : 0;
                  
                  return (
                    <tr key={metric.tenantId} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{metric.name}</div>
                        <div className="text-xs text-gray-500">{metric.tenantId.slice(0, 8)}...</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-medium">£{metric.revenue.toLocaleString()}</div>
                        <div className="w-full bg-gray-200 rounded-full h-1 mt-1">
                          <div
                            className="bg-blue-600 h-1 rounded-full"
                            style={{ width: `${revenuePercent}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        £{metric.expenses.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className={`font-medium ${metric.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          £{metric.profit.toLocaleString()}
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1 mt-1">
                          <div
                            className={`h-1 rounded-full ${metric.profit >= 0 ? 'bg-green-600' : 'bg-red-600'}`}
                            style={{ width: `${Math.abs(profitPercent)}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-medium ${
                          metric.profitMargin >= 0.2 ? 'text-green-600' :
                          metric.profitMargin >= 0.1 ? 'text-yellow-600' :
                          'text-red-600'
                        }`}>
                          {(metric.profitMargin * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-medium ${
                          metric.growthRate >= 0.1 ? 'text-green-600' :
                          metric.growthRate >= 0 ? 'text-yellow-600' :
                          'text-red-600'
                        }`}>
                          {(metric.growthRate * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">
                        £{metric.vatDue.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          metric.upcomingDeadlines > 3 ? 'bg-red-100 text-red-800' :
                          metric.upcomingDeadlines > 0 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-green-100 text-green-800'
                        }`}>
                          {metric.upcomingDeadlines}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
