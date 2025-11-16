'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';
import ConfidenceScoreIndicator from './ConfidenceScoreIndicator';

const logger = createLogger('QualityChecker');

interface QualityCheck {
  id: string;
  check: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
  severity: 'low' | 'medium' | 'high';
  field?: string;
  suggestedFix?: string;
}

interface QualityCheckerProps {
  documentId: string;
  token: string;
  onQualityChange?: (quality: number) => void; // 0-1
}

export default function QualityChecker({
  documentId,
  token,
  onQualityChange,
}: QualityCheckerProps) {
  const [checks, setChecks] = useState<QualityCheck[]>([]);
  const [overallQuality, setOverallQuality] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (documentId) {
      runQualityChecks();
    }
  }, [documentId]);

  const runQualityChecks = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/documents/${documentId}/quality-check`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to run quality checks');

      const data = await response.json();
      setChecks(data.checks || []);
      
      const passed = data.checks?.filter((c: QualityCheck) => c.status === 'pass').length || 0;
      const total = data.checks?.length || 1;
      const quality = passed / total;
      
      setOverallQuality(quality);
      if (onQualityChange) {
        onQualityChange(quality);
      }
    } catch (error) {
      logger.error('Failed to run quality checks', error);
      alert('Failed to run quality checks');
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pass':
        return '✅';
      case 'fail':
        return '❌';
      case 'warning':
        return '⚠️';
      default:
        return '○';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pass':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'fail':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'warning':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'high':
        return 'bg-red-200 text-red-900';
      case 'medium':
        return 'bg-orange-200 text-orange-900';
      default:
        return 'bg-yellow-200 text-yellow-900';
    }
  };

  const passedCount = checks.filter(c => c.status === 'pass').length;
  const failedCount = checks.filter(c => c.status === 'fail').length;
  const warningCount = checks.filter(c => c.status === 'warning').length;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold">Document Quality Check</h2>
          <div className="mt-2">
            <ConfidenceScoreIndicator score={overallQuality} size="md" />
          </div>
        </div>
        <button
          onClick={runQualityChecks}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Checking...' : 'Re-check'}
        </button>
      </div>

      {loading && checks.length === 0 ? (
        <div className="text-center py-8 text-gray-500">Running quality checks...</div>
      ) : checks.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No quality checks available</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-green-50 border border-green-200 rounded p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{passedCount}</p>
              <p className="text-sm text-green-800">Passed</p>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-center">
              <p className="text-2xl font-bold text-yellow-600">{warningCount}</p>
              <p className="text-sm text-yellow-800">Warnings</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{failedCount}</p>
              <p className="text-sm text-red-800">Failed</p>
            </div>
          </div>

          <div className="space-y-3">
            {checks.map((check) => (
              <div
                key={check.id}
                className={`p-4 rounded-lg border-2 ${getStatusColor(check.status)}`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{getStatusIcon(check.status)}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{check.check}</h3>
                      {check.severity && (
                        <span className={`text-xs px-2 py-1 rounded ${getSeverityBadge(check.severity)}`}>
                          {check.severity.toUpperCase()}
                        </span>
                      )}
                      {check.field && (
                        <span className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded">
                          Field: {check.field}
                        </span>
                      )}
                    </div>
                    <p className="text-sm mb-2">{check.message}</p>
                    {check.suggestedFix && (
                      <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
                        <p className="text-xs font-medium text-blue-900 mb-1">💡 Suggested Fix:</p>
                        <p className="text-xs text-blue-800">{check.suggestedFix}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
