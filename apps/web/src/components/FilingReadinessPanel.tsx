'use client';

import React, { useEffect, useState } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

interface Filing {
  id: string;
  filing_type: string;
  period_start: string;
  period_end: string;
  status: string;
}

interface ReadinessSnapshot {
  overall: number;
  dataCompleteness: number;
  reconciliation: number;
  connectorHealth: number;
  taskCompletion: number;
  details: {
    missingData: string[];
    unmatchedTransactions: number;
    unhealthyConnectors: string[];
    pendingTasks: number;
  };
}

const logger = createLogger('FilingReadinessPanel');
const API = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

export default function FilingReadinessPanel({ token }: { token: string }) {
  const [filings, setFilings] = useState<Filing[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, ReadinessSnapshot>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadFilings();
  }, []);

  const loadFilings = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API}/api/filings?status=pending_approval`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('Failed to load filings');
      }
      const data = (await response.json()) as { filings: Filing[] };
      const pending = (data.filings || []).slice(0, 3);
      setFilings(pending);
      await Promise.all(pending.map(filing => loadReadiness(filing.id)));
    } catch (error) {
      logger.error('Failed to load filings', error);
    } finally {
      setLoading(false);
    }
  };

  const loadReadiness = async (filingId: string) => {
    try {
      const response = await fetch(`${API}/api/filings/${filingId}/readiness`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('Failed to fetch readiness');
      }
      const data = (await response.json()) as { readiness: ReadinessSnapshot };
      setSnapshots(prev => ({ ...prev, [filingId]: data.readiness }));
    } catch (error) {
      logger.error('Failed to load readiness', error);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <p>Loading readiness checks…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Filing Readiness</h2>
        <p className="text-sm text-gray-500">Top filings awaiting submission</p>
      </div>
      {filings.length === 0 ? (
        <p className="text-sm text-gray-500">No filings pending approval.</p>
      ) : (
        filings.map(filing => {
          const readiness = snapshots[filing.id];
          return (
            <div key={filing.id} className="rounded border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">
                    {filing.filing_type.toUpperCase()} · {new Date(filing.period_start).toLocaleDateString()} -{' '}
                    {new Date(filing.period_end).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-gray-500">Status: {filing.status}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-gray-900">
                    {readiness ? `${readiness.overall}%` : '—'}
                  </p>
                  <p className="text-xs text-gray-500">Readiness</p>
                </div>
              </div>
              {readiness && (
                <div className="grid grid-cols-2 gap-4 mt-3 text-xs text-gray-600">
                  <div>
                    <p>Data completeness</p>
                    <p className="font-semibold text-gray-900">{readiness.dataCompleteness}%</p>
                    {readiness.details.missingData.length > 0 && (
                      <p className="text-red-600">Missing: {readiness.details.missingData.join(', ')}</p>
                    )}
                  </div>
                  <div>
                    <p>Reconciliation</p>
                    <p className="font-semibold text-gray-900">{readiness.reconciliation}%</p>
                    {readiness.details.unmatchedTransactions > 0 && (
                      <p className="text-red-600">
                        {readiness.details.unmatchedTransactions} transactions open
                      </p>
                    )}
                  </div>
                  <div>
                    <p>Connectors</p>
                    <p className="font-semibold text-gray-900">{readiness.connectorHealth}%</p>
                    {readiness.details.unhealthyConnectors.length > 0 && (
                      <p className="text-red-600">Issues: {readiness.details.unhealthyConnectors.join(', ')}</p>
                    )}
                  </div>
                  <div>
                    <p>Tasks</p>
                    <p className="font-semibold text-gray-900">{readiness.taskCompletion}%</p>
                    {readiness.details.pendingTasks > 0 && (
                      <p className="text-red-600">{readiness.details.pendingTasks} tasks pending</p>
                    )}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end mt-3 space-x-2">
                <button
                  onClick={() => loadReadiness(filing.id)}
                  className="px-3 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50"
                >
                  Refresh
                </button>
                <button
                  onClick={() => {
                    window.location.href = `/filings/${filing.id}`;
                  }}
                  className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                  View filing
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
