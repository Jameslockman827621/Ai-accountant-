'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('FilingComparison');

interface ComparisonDifference {
  field: string;
  currentValue: unknown;
  previousValue: unknown;
  difference: number;
  percentageChange: number;
  significance: 'low' | 'medium' | 'high';
}

interface FilingComparisonProps {
  filingId: string;
  comparisonType?: 'period' | 'year' | 'both';
}

export default function FilingComparison({
  filingId,
  comparisonType = 'both',
}: FilingComparisonProps) {
  const [comparison, setComparison] = useState<{
    currentFiling: { id: string; periodStart: string; periodEnd: string; data: Record<string, unknown> };
    previousFiling?: { id: string; periodStart: string; periodEnd: string; data: Record<string, unknown> };
    yearOverYear?: { previousYear: { id: string; periodStart: string; periodEnd: string; data: Record<string, unknown> } };
    differences: ComparisonDifference[];
    warnings: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState<'period' | 'year' | 'both'>(comparisonType);

  useEffect(() => {
    loadComparison();
  }, [filingId, selectedType]);

  const loadComparison = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/filings/${filingId}/compare?type=${selectedType}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load comparison');

      const data = await response.json();
      setComparison(data.comparison);
    } catch (error) {
      logger.error('Failed to load comparison', error);
    } finally {
      setLoading(false);
    }
  };

  const getSignificanceColor = (significance: string) => {
    switch (significance) {
      case 'high':
        return 'bg-red-50 border-red-200';
      case 'medium':
        return 'bg-yellow-50 border-yellow-200';
      default:
        return 'bg-green-50 border-green-200';
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading comparison...</div>;
  }

  if (!comparison) {
    return <div className="text-gray-500">No comparison data available</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Filing Comparison</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedType('period')}
            className={`px-3 py-1 rounded text-sm ${
              selectedType === 'period' ? 'bg-blue-600 text-white' : 'bg-gray-200'
            }`}
          >
            Period
          </button>
          <button
            onClick={() => setSelectedType('year')}
            className={`px-3 py-1 rounded text-sm ${
              selectedType === 'year' ? 'bg-blue-600 text-white' : 'bg-gray-200'
            }`}
          >
            Year
          </button>
          <button
            onClick={() => setSelectedType('both')}
            className={`px-3 py-1 rounded text-sm ${
              selectedType === 'both' ? 'bg-blue-600 text-white' : 'bg-gray-200'
            }`}
          >
            Both
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-blue-50 rounded">
          <p className="text-sm text-gray-600">Current Period</p>
          <p className="font-semibold">
            {new Date(comparison.currentFiling.periodStart).toLocaleDateString()} -{' '}
            {new Date(comparison.currentFiling.periodEnd).toLocaleDateString()}
          </p>
        </div>
        {comparison.previousFiling && (
          <div className="p-4 bg-gray-50 rounded">
            <p className="text-sm text-gray-600">Previous Period</p>
            <p className="font-semibold">
              {new Date(comparison.previousFiling.periodStart).toLocaleDateString()} -{' '}
              {new Date(comparison.previousFiling.periodEnd).toLocaleDateString()}
            </p>
          </div>
        )}
      </div>

      {comparison.warnings.length > 0 && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
          <h3 className="font-semibold mb-2">⚠️ Warnings</h3>
          <ul className="list-disc pl-6">
            {comparison.warnings.map((warn, i) => (
              <li key={i} className="text-sm">{warn}</li>
            ))}
          </ul>
        </div>
      )}

      {comparison.differences.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold mb-3">Differences</h3>
          {comparison.differences.map((diff, i) => (
            <div
              key={i}
              className={`p-4 rounded border ${getSignificanceColor(diff.significance)}`}
            >
              <div className="flex justify-between items-start mb-2">
                <p className="font-medium capitalize">{diff.field.replace(/_/g, ' ')}</p>
                <span className={`px-2 py-1 rounded text-xs ${
                  diff.significance === 'high' ? 'bg-red-200 text-red-800' :
                  diff.significance === 'medium' ? 'bg-yellow-200 text-yellow-800' :
                  'bg-green-200 text-green-800'
                }`}>
                  {diff.significance.toUpperCase()}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-gray-600">Current</p>
                  <p className="font-semibold">{String(diff.currentValue)}</p>
                </div>
                <div>
                  <p className="text-gray-600">Previous</p>
                  <p className="font-semibold">{String(diff.previousValue)}</p>
                </div>
                <div>
                  <p className="text-gray-600">Change</p>
                  <p className={`font-semibold ${
                    diff.percentageChange > 0 ? 'text-red-600' : 'text-green-600'
                  }`}>
                    {diff.percentageChange > 0 ? '+' : ''}{diff.percentageChange.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {comparison.differences.length === 0 && (
        <div className="p-4 bg-green-50 border border-green-200 rounded">
          <p className="text-green-800">✅ No significant differences detected</p>
        </div>
      )}
    </div>
  );
}
