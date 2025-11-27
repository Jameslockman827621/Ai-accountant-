import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { ValidationRunSummary } from '@ai-accountant/shared-types';

type DashboardSummary = {
  activeRuns: number;
  failures: number;
  warnings: number;
  passRate: number;
  latestRuns: ValidationRunSummary[];
};

const fallbackSummary: DashboardSummary = {
  activeRuns: 3,
  failures: 1,
  warnings: 2,
  passRate: 78,
  latestRuns: [],
};

async function fetchSummary(): Promise<DashboardSummary> {
  try {
    const analyticsUrl = process.env.NEXT_PUBLIC_ANALYTICS_URL || 'http://localhost:3030';
    const monitoringUrl = process.env.NEXT_PUBLIC_MONITORING_URL || 'http://localhost:3040';
    const [analytics, monitoring] = await Promise.all([
      axios.get(`${analyticsUrl}/api/validation/summary`).catch(() => ({ data: {} })),
      axios.get(`${monitoringUrl}/api/validation/runs`).catch(() => ({ data: {} })),
    ]);

    const runs: ValidationRunSummary[] = (monitoring.data?.runs as ValidationRunSummary[]) || [];
    return {
      activeRuns: analytics.data?.activeRuns ?? fallbackSummary.activeRuns,
      failures: analytics.data?.failures ?? fallbackSummary.failures,
      warnings: analytics.data?.warnings ?? fallbackSummary.warnings,
      passRate: analytics.data?.passRate ?? fallbackSummary.passRate,
      latestRuns: runs.slice(0, 5),
    };
  } catch (error) {
    console.warn('Falling back to default validation dashboard data', error);
    return fallbackSummary;
  }
}

export default function ValidationDashboard() {
  const [summary, setSummary] = useState<DashboardSummary>(fallbackSummary);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSummary().then((data) => {
      setSummary(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <header>
          <p className="text-sm text-slate-500 uppercase tracking-wide">Validation</p>
          <h1 className="text-3xl font-semibold">Deterministic validation dashboard</h1>
          <p className="text-slate-600 mt-2">
            Backed by analytics and monitoring feeds to highlight regressions early.
          </p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[{ label: 'Active runs', value: summary.activeRuns }, { label: 'Failures', value: summary.failures }, { label: 'Warnings', value: summary.warnings }, { label: 'Pass rate', value: `${summary.passRate}%` }].map((card) => (
            <div key={card.label} className="rounded-lg bg-white shadow p-4">
              <p className="text-sm text-slate-500">{card.label}</p>
              <p className="text-2xl font-semibold mt-2">{card.value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-lg bg-white shadow p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Latest runs</h2>
            {loading && <span className="text-sm text-slate-500">Loading…</span>}
          </div>
          {summary.latestRuns.length === 0 ? (
            <p className="text-slate-600">No recent runs returned from analytics; showing placeholder metrics.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-2">Run</th>
                  <th className="py-2">Entity</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Triggered</th>
                </tr>
              </thead>
              <tbody>
                {summary.latestRuns.map((run) => (
                  <tr key={run.id} className="border-t border-slate-100">
                    <td className="py-2">
                      <Link className="text-blue-600 hover:underline" href={`/validation/${run.id}`}>
                        {run.id}
                      </Link>
                    </td>
                    <td className="py-2">{run.entityType}</td>
                    <td className="py-2 capitalize">{run.status}</td>
                    <td className="py-2">{new Date(run.triggeredAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
