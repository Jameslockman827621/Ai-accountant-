'use client';

import React, { useEffect, useState } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

interface ClientSummary {
  headline: string;
  readinessScore: number;
  changes: string[];
  nextSteps: string[];
  period: { start: string; end: string };
}

const logger = createLogger('ClientCommunicationPanel');
const API = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

export default function ClientCommunicationPanel({ token }: { token: string }) {
  const [summary, setSummary] = useState<ClientSummary | null>(null);
  const [filingId, setFilingId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = async () => {
    if (!filingId) {
      setError('Enter a filing ID to build the summary');
      return;
    }
    try {
      setError(null);
      setLoading(true);
      const response = await fetch(`${API}/api/filings/${filingId}/client-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('Failed to generate summary');
      }
      const data = (await response.json()) as { summary: ClientSummary };
      setSummary(data.summary);
    } catch (err) {
      logger.error('Client summary failed', err);
      setError('Unable to generate client-facing summary');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Client Communication</h2>
          <p className="text-sm text-gray-500">Generate “what changed” updates for clients</p>
        </div>
        <div className="flex items-center space-x-2">
          <input
            value={filingId}
            onChange={event => setFilingId(event.target.value)}
            placeholder="Filing ID"
            className="border border-gray-300 rounded px-3 py-1 text-sm"
          />
          <button
            onClick={loadSummary}
            disabled={loading}
            className="px-3 py-1 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {summary ? (
        <div className="space-y-3">
          <div className="rounded border border-gray-200 p-4 bg-gray-50">
            <p className="text-sm text-gray-500">
              Period {summary.period.start} – {summary.period.end}
            </p>
            <p className="text-lg font-semibold text-gray-900">{summary.headline}</p>
            <p className="text-sm text-gray-600">Readiness: {summary.readinessScore}%</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="border border-gray-200 rounded p-4">
              <h3 className="font-semibold mb-2 text-gray-800">What changed?</h3>
              {summary.changes.length === 0 ? (
                <p className="text-gray-500">No material changes detected.</p>
              ) : (
                <ul className="list-disc list-inside space-y-1 text-gray-700">
                  {summary.changes.map(change => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border border-gray-200 rounded p-4">
              <h3 className="font-semibold mb-2 text-gray-800">Next steps</h3>
              {summary.nextSteps.length === 0 ? (
                <p className="text-gray-500">All set—no immediate client actions.</p>
              ) : (
                <ul className="list-disc list-inside space-y-1 text-gray-700">
                  {summary.nextSteps.map(step => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500">Provide a filing ID to generate a client-ready update.</p>
      )}
    </div>
  );
}
