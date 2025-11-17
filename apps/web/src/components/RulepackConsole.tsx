'use client';

import React, { useEffect, useState } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

interface Rulepack {
  id: string;
  jurisdiction: string;
  version: string;
  status: string;
  isActive: boolean;
  metadata?: Record<string, unknown>;
}

interface RegressionRun {
  id: string;
  status: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  startedAt: string;
  completedAt?: string;
}

const logger = createLogger('RulepackConsole');
const API =
  (process.env.NEXT_PUBLIC_RULEPACK_SERVICE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3012').replace(/\/$/, '');

export default function RulepackConsole({ token }: { token: string }) {
  const [rulepacks, setRulepacks] = useState<Rulepack[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDiff, setSelectedDiff] = useState<{ diff: Array<{ path: string; before: unknown; after: unknown }>; label: string } | null>(null);
  const [selectedRun, setSelectedRun] = useState<RegressionRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadRulepacks();
  }, []);

  const loadRulepacks = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API}/api/rulepacks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Failed to load rulepacks (${response.status})`);
      }
      const data = (await response.json()) as { rulepacks: Rulepack[] };
      setRulepacks(data.rulepacks || []);
    } catch (err) {
      logger.error('Failed to load rulepacks', err);
      setError('Unable to load rulepack catalog');
    } finally {
      setLoading(false);
    }
  };

  const runRegression = async (rulepackId: string) => {
    try {
      const response = await fetch(`${API}/api/rulepacks/${rulepackId}/regression`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ blocking: true, runType: 'manual' }),
      });
      if (!response.ok) {
        throw new Error(`Regression failed (${response.status})`);
      }
      const data = (await response.json()) as { run: RegressionRun };
      setSelectedRun(data.run);
      await loadRulepacks();
      alert('Regression completed');
    } catch (err) {
      logger.error('Regression run failed', err);
      alert('Failed to run regression suite');
    }
  };

  const fetchDiff = async (rulepack: Rulepack) => {
    const previousVersion = prompt('Enter version to compare against:', '1.0.0');
    if (!previousVersion) return;
    try {
      const response = await fetch(
        `${API}/api/rulepacks/${rulepack.id}/diff?compareTo=${encodeURIComponent(previousVersion)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!response.ok) {
        throw new Error('Unable to load diff');
      }
      const data = (await response.json()) as { diff: Array<{ path: string; before: unknown; after: unknown }> };
      setSelectedDiff({ diff: data.diff || [], label: `${rulepack.jurisdiction} v${rulepack.version} vs ${previousVersion}` });
    } catch (err) {
      logger.error('Diff fetch failed', err);
      alert('Failed to load diff');
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <p>Loading rulepack console…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
        {error}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Rulepack Console</h2>
          <p className="text-sm text-gray-500">Monitor versions, run regressions, and review diffs</p>
        </div>
        <button
          onClick={loadRulepacks}
          className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 uppercase tracking-wide">
              <th className="py-2">Jurisdiction</th>
              <th className="py-2">Version</th>
              <th className="py-2">Status</th>
              <th className="py-2">Git</th>
              <th className="py-2">Regression</th>
              <th className="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rulepacks.map(rulepack => (
              <tr key={rulepack.id} className="border-t">
                <td className="py-2 font-medium">{rulepack.jurisdiction}</td>
                <td className="py-2">{rulepack.version}</td>
                <td className="py-2">
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      rulepack.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {rulepack.status}
                  </span>
                </td>
                <td className="py-2 text-xs text-gray-500">
                  {(rulepack.metadata?.gitSnapshot as { path?: string; status?: string } | undefined)?.path || '—'}
                </td>
                <td className="py-2 text-xs text-gray-500">
                  {(rulepack.metadata?.regressionQuality as { passRate?: number } | undefined)?.passRate
                    ? `${Math.round(
                        Number(
                          (rulepack.metadata?.regressionQuality as { passRate?: number }).passRate ?? 0
                        ) * 100
                      )}%`
                    : 'n/a'}
                </td>
                <td className="py-2 text-right space-x-2">
                  <button
                    onClick={() => runRegression(rulepack.id)}
                    className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                  >
                    Run regression
                  </button>
                  <button
                    onClick={() => fetchDiff(rulepack)}
                    className="px-3 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50"
                  >
                    View diff
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedDiff && (
        <div className="rounded border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-gray-700">Diff: {selectedDiff.label}</h3>
            <button className="text-sm text-blue-600" onClick={() => setSelectedDiff(null)}>
              Close
            </button>
          </div>
          {selectedDiff.diff.length === 0 ? (
            <p className="text-sm text-gray-600">No differences detected.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-auto text-sm">
              {selectedDiff.diff.map(entry => (
                <li key={entry.path} className="bg-white rounded border border-gray-200 p-2">
                  <p className="font-mono text-xs text-gray-500">{entry.path}</p>
                  <p className="text-red-600 text-xs">- {JSON.stringify(entry.before)}</p>
                  <p className="text-green-600 text-xs">+ {JSON.stringify(entry.after)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {selectedRun && (
        <div className="rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <div className="flex items-center justify-between">
            <span>
              Latest regression run {selectedRun.status.toUpperCase()} (
              {selectedRun.passedTests}/{selectedRun.totalTests})
            </span>
            <button onClick={() => setSelectedRun(null)} className="text-blue-600">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
