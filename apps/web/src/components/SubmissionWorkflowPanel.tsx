'use client';

import React, { useEffect, useState } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

interface FilingWorkflowItem {
  id: string;
  filing_type: string;
  status: string;
  period_start: string;
  period_end: string;
}

const logger = createLogger('SubmissionWorkflowPanel');
const API = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/, '');

export default function SubmissionWorkflowPanel({ token }: { token: string }) {
  const [filings, setFilings] = useState<FilingWorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadWorkflows();
  }, []);

  const loadWorkflows = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API}/api/filings?status=pending_approval`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error('Failed to load filings');
      }
      const data = (await response.json()) as { filings: FilingWorkflowItem[] };
      setFilings(data.filings || []);
    } catch (err) {
      logger.error('Load workflows failed', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <p>Loading submission workflow…</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Submission Workflow</h2>
          <p className="text-sm text-gray-500">Track each filing’s approval and submission state</p>
        </div>
        <button
          onClick={loadWorkflows}
          className="px-3 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>
      {filings.length === 0 ? (
        <p className="text-sm text-gray-500">No filings awaiting submission.</p>
      ) : (
        <div className="space-y-3">
          {filings.map(filing => (
            <div key={filing.id} className="border border-gray-200 rounded p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold text-gray-900">
                    {filing.filing_type.toUpperCase()} ·{' '}
                    {new Date(filing.period_start).toLocaleDateString()} -{' '}
                    {new Date(filing.period_end).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-gray-500">ID: {filing.id}</p>
                </div>
                <span className="px-2 py-1 rounded text-xs bg-blue-50 text-blue-800">
                  {filing.status.replace('_', ' ')}
                </span>
              </div>
              <div className="flex items-center space-x-4 text-xs text-gray-600">
                {['draft', 'pending_approval', 'approved', 'submitted'].map(stage => (
                  <StageDot key={stage} label={stage} active={stage === filing.status} />
                ))}
              </div>
              <div className="flex justify-end mt-3">
                <button
                  onClick={() => (window.location.href = `/filings/${filing.id}`)}
                  className="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                  Review filing
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StageDot({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center space-x-1">
      <span className={`w-3 h-3 rounded-full ${active ? 'bg-blue-600' : 'bg-gray-300'}`}></span>
      <span className={active ? 'text-blue-700 font-semibold' : ''}>{label.replace('_', ' ')}</span>
    </div>
  );
}
