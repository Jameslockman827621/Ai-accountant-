'use client';

import { useEffect, useMemo, useState } from 'react';

interface ReconciliationSummary {
  totalTransactions: number;
  reconciledTransactions: number;
  pendingTransactions: number;
  pendingAmount: number;
  autoMatchRate: number;
  ledgerPendingEntries: number;
  lastReconciledAt: string | null;
  openExceptions: number;
  criticalExceptions: number;
  avgTimeToReconcileHours: number | null;
}

interface TrendPoint {
  date: string;
  totalTransactions: number;
  reconciledTransactions: number;
  pendingTransactions: number;
  openExceptions: number;
}

interface ReconciliationDashboardProps {
  token: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function ReconciliationDashboard({ token }: ReconciliationDashboardProps) {
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const [summaryRes, trendRes] = await Promise.all([
          fetch(`${API_BASE}/api/reconciliation/summary`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_BASE}/api/reconciliation/summary/trend?days=21`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        if (!summaryRes.ok) {
          throw new Error(`Summary request failed (${summaryRes.status})`);
        }
        if (!trendRes.ok) {
          throw new Error(`Trend request failed (${trendRes.status})`);
        }

        const summaryJson = await summaryRes.json() as { summary: ReconciliationSummary };
        const trendJson = await trendRes.json() as { trend: TrendPoint[] };

        if (isMounted) {
          setSummary(summaryJson.summary);
          setTrend(trendJson.trend || []);
        }
      } catch (err) {
        console.error(err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load reconciliation data');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [token]);

  const trendMax = useMemo(() => {
    if (trend.length === 0) return 1;
    return Math.max(...trend.map(point => point.totalTransactions || 1), 1);
  }, [trend]);

  if (loading && !summary) {
    return (
      <section className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-2">Reconciliation Health</h3>
        <p className="text-sm text-gray-500">Loading reconciliation metrics…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-2">Reconciliation Health</h3>
        <p className="text-sm text-red-600">{error}</p>
      </section>
    );
  }

  if (!summary) {
    return null;
  }

  const cards = [
    {
      label: 'Pending Bank Txns',
      value: summary.pendingTransactions,
      sublabel: `£${summary.pendingAmount.toFixed(2)} outstanding`,
    },
    {
      label: 'Auto-match Rate',
      value: `${(summary.autoMatchRate * 100).toFixed(1)}%`,
      sublabel: `${summary.reconciledTransactions}/${summary.totalTransactions} reconciled`,
    },
    {
      label: 'Ledger Entries Awaiting Match',
      value: summary.ledgerPendingEntries,
      sublabel: 'Ledger lines that still need pairing',
    },
    {
      label: 'Open Exceptions',
      value: summary.openExceptions,
      sublabel: `${summary.criticalExceptions} critical`,
    },
    {
      label: 'Avg Time to Reconcile',
      value: summary.avgTimeToReconcileHours != null ? `${summary.avgTimeToReconcileHours}h` : 'n/a',
      sublabel: summary.lastReconciledAt
        ? `Last posted ${new Date(summary.lastReconciledAt).toLocaleString('en-GB')}`
        : 'No reconciled items yet',
    },
  ];

  return (
    <section className="bg-white rounded-lg shadow p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">Reconciliation Health</h3>
          <p className="text-sm text-gray-500">
            Snapshot of bank vs ledger alignment and exception queue.
          </p>
        </div>
        {loading && (
          <span className="text-xs text-gray-500">Updating…</span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(card => (
          <div key={card.label} className="border rounded-lg p-4 bg-gray-50">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="text-2xl font-semibold text-gray-900">{card.value}</p>
            <p className="text-xs text-gray-500">{card.sublabel}</p>
          </div>
        ))}
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
          3-week trend
        </h4>
        {trend.length === 0 ? (
          <p className="text-sm text-gray-500">No transaction activity yet.</p>
        ) : (
          <div className="flex items-end gap-2 h-40">
            {trend.map(point => {
              const totalHeight = (point.totalTransactions / trendMax) * 100;
              const reconciledHeight = (point.reconciledTransactions / trendMax) * 100;
              return (
                <div key={point.date} className="flex-1 flex flex-col items-center space-y-2">
                  <div className="w-full bg-gray-100 rounded h-32 flex flex-col justify-end">
                    <div
                      className="bg-green-500 rounded-t"
                      style={{ height: `${reconciledHeight}%` }}
                    />
                    <div
                      className="bg-red-300 rounded-b"
                      style={{ height: `${totalHeight - reconciledHeight}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-gray-500">{point.date.slice(5)}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
