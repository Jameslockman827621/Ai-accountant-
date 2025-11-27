'use client';

import { useEffect, useState } from 'react';

interface DrSimulationLog {
  backupId: string;
  simulationId: string;
  rtoSeconds: number;
  rpoMinutes: number;
  status: 'passed' | 'failed';
  integrityVerified: boolean;
  notes?: string;
  createdAt?: string;
}

interface DrMetrics {
  avgRtoSeconds: number;
  avgRpoMinutes: number;
  passRate: number;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_MONITORING_URL || '';
    const res = await fetch(`${baseUrl}${path}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (error) {
    console.error('Failed to fetch DR data', error);
    return null;
  }
}

export default function DisasterRecoveryDashboard() {
  const [simulations, setSimulations] = useState<DrSimulationLog[]>([]);
  const [metrics, setMetrics] = useState<DrMetrics | null>(null);

  useEffect(() => {
    async function load() {
      const logs = await fetchJson<{ logs: DrSimulationLog[] }>('/api/monitoring/dr-simulations');
      if (logs?.logs) {
        setSimulations(logs.logs);
      } else {
        setSimulations([]);
      }

      const snapshot = await fetchJson<DrMetrics>('/api/monitoring/dr-simulations/metrics');
      if (snapshot) {
        setMetrics(snapshot);
      }
    }

    load();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-2xl font-semibold text-gray-900">Disaster Recovery</h1>
          <p className="mt-1 text-sm text-gray-600">Monthly simulations, backup integrity, and RPO/RTO posture.</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">Average RTO</p>
            <p className="text-2xl font-semibold text-gray-900">{metrics ? `${Math.round(metrics.avgRtoSeconds)}s` : '—'}</p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">Average RPO</p>
            <p className="text-2xl font-semibold text-gray-900">{metrics ? `${Math.round(metrics.avgRpoMinutes)}m` : '—'}</p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">Pass Rate</p>
            <p className="text-2xl font-semibold text-gray-900">
              {metrics ? `${Math.round(metrics.passRate * 100)}%` : '—'}
            </p>
          </div>
        </section>

        <section className="rounded-lg bg-white shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Recent DR Simulations</h2>
              <p className="text-sm text-gray-500">Logged by monitoring service after monthly restore drills.</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Backup</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Simulation</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">RTO</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">RPO</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Integrity</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Notes</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {simulations.length === 0 && (
                  <tr>
                    <td className="px-4 py-4 text-sm text-gray-500" colSpan={7}>
                      No drills logged yet. Monitoring will publish monthly results once runs complete.
                    </td>
                  </tr>
                )}
                {simulations.map((entry) => (
                  <tr key={entry.simulationId}>
                    <td className="px-4 py-3 text-sm text-gray-900">{entry.backupId}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{entry.simulationId}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{entry.rtoSeconds}s</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{entry.rpoMinutes}m</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{entry.integrityVerified ? 'Verified' : 'Missing'}</td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${
                          entry.status === 'passed'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{entry.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
