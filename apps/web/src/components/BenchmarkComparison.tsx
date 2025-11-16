'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('BenchmarkComparison');

interface BenchmarkComparison {
  metric: string;
  userValue: number;
  industryAverage: number;
  percentile: number;
  performance: 'above_average' | 'average' | 'below_average';
  recommendation?: string;
}

interface BenchmarkComparisonProps {
  token: string;
  tenantId: string;
  industry: string;
  period?: string;
}

export default function BenchmarkComparison({
  token,
  tenantId,
  industry,
  period = '2024',
}: BenchmarkComparisonProps) {
  const [comparisons, setComparisons] = useState<BenchmarkComparison[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadComparisons();
  }, [industry, period]);

  const loadComparisons = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/analytics/benchmark?industry=${industry}&period=${period}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) throw new Error('Failed to load benchmarks');

      const data = await response.json();
      setComparisons(data.comparisons || []);
    } catch (error) {
      logger.error('Failed to load benchmarks', error);
    } finally {
      setLoading(false);
    }
  };

  const getPerformanceColor = (performance: string) => {
    switch (performance) {
      case 'above_average':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'average':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'below_average':
        return 'text-red-600 bg-red-50 border-red-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const formatMetric = (metric: string): string => {
    return metric
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatValue = (value: number, metric: string): string => {
    if (metric.includes('margin') || metric.includes('ratio')) {
      return `${(value * 100).toFixed(1)}%`;
    }
    return `£${value.toLocaleString()}`;
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-500">Loading benchmarks...</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Industry Benchmarks</h2>
        <span className="text-sm text-gray-600 capitalize">{industry.replace(/_/g, ' ')}</span>
      </div>

      {comparisons.length === 0 ? (
        <div className="text-center py-8 text-gray-500">No benchmark data available</div>
      ) : (
        <div className="space-y-4">
          {comparisons.map((comparison) => (
            <div
              key={comparison.metric}
              className={`p-4 rounded-lg border-2 ${getPerformanceColor(comparison.performance)}`}
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold">{formatMetric(comparison.metric)}</h3>
                  <p className="text-sm mt-1">
                    You: <span className="font-medium">{formatValue(comparison.userValue, comparison.metric)}</span>
                    {' • '}
                    Industry Avg: <span className="font-medium">{formatValue(comparison.industryAverage, comparison.metric)}</span>
                  </p>
                </div>
                <div className="text-right">
                  <div className={`text-lg font-bold ${
                    comparison.performance === 'above_average' ? 'text-green-600' :
                    comparison.performance === 'below_average' ? 'text-red-600' :
                    'text-yellow-600'
                  }`}>
                    {comparison.percentile}th
                  </div>
                  <div className="text-xs text-gray-600">Percentile</div>
                </div>
              </div>

              <div className="mb-2">
                <div className="flex justify-between text-xs mb-1">
                  <span>Your Performance</span>
                  <span>{comparison.percentile}th percentile</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      comparison.performance === 'above_average' ? 'bg-green-600' :
                      comparison.performance === 'below_average' ? 'bg-red-600' :
                      'bg-yellow-600'
                    }`}
                    style={{ width: `${comparison.percentile}%` }}
                  />
                </div>
              </div>

              {comparison.recommendation && (
                <div className="mt-3 p-2 bg-blue-50 border border-blue-200 rounded">
                  <p className="text-xs text-blue-900">
                    <strong>💡 Recommendation:</strong> {comparison.recommendation}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
