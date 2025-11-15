'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

type InsightSeverity = 'info' | 'warning' | 'critical';

interface Insight {
  id: string;
  title: string;
  message: string;
  severity: InsightSeverity;
  action?: string;
  cta?: string;
}

interface ExecutiveInsightsPanelProps {
  token: string;
}

const severityStyles: Record<InsightSeverity, string> = {
  info: 'border-blue-100 bg-blue-50 text-blue-900',
  warning: 'border-amber-100 bg-amber-50 text-amber-900',
  critical: 'border-red-100 bg-red-50 text-red-900',
};

export default function ExecutiveInsightsPanel({ token }: ExecutiveInsightsPanelProps) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const headers = useMemo<HeadersInit>(
    () => ({
      Authorization: `Bearer ${token}`,
    }),
    [token]
  );

  const fetchInsights = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`${API_BASE}/api/analytics/insights`, { headers });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || 'Failed to load insights');
      }
      const data = (await response.json()) as { insights: Insight[] };
      setInsights(data.insights || []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Unable to fetch insights right now');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    void fetchInsights();
  }, [fetchInsights]);

  return (
    <section className="rounded-2xl bg-white p-6 shadow space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Executive Insights</h3>
          <p className="text-sm text-gray-500">Key risks and opportunities detected in the last 30 days.</p>
        </div>
        <button
          onClick={() => fetchInsights()}
          className="text-sm text-gray-500 underline decoration-dotted"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Scanning latest ledgers and filings…</p>
      ) : (
        <div className="space-y-3">
          {insights.map((insight) => (
            <article
              key={insight.id}
              className={`rounded-xl border px-4 py-3 text-sm ${severityStyles[insight.severity]}`}
            >
              <div className="flex items-center gap-2">
                <SeverityDot severity={insight.severity} />
                <h4 className="font-semibold">{insight.title}</h4>
              </div>
              <p className="mt-1">{insight.message}</p>
              {insight.action && <p className="mt-1 font-medium">{insight.action}</p>}
              {insight.cta && (
                <p className="mt-1 text-xs uppercase tracking-wide text-gray-600">{insight.cta}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SeverityDot({ severity }: { severity: InsightSeverity }) {
  const color =
    severity === 'critical'
      ? 'bg-red-500'
      : severity === 'warning'
        ? 'bg-amber-500'
        : 'bg-blue-500';
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}
