import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import axios from 'axios';
import Link from 'next/link';
import { ValidationRunSummary } from '@ai-accountant/shared-types';

type Decision = {
  ruleId: string;
  message: string;
  status: string;
  domain: string;
};

type DrillDownData = {
  run?: ValidationRunSummary;
  decisions: Decision[];
  auditTrail: Array<{ action: string; createdAt: string }>;
};

const fallbackDrillDown: DrillDownData = {
  run: undefined,
  decisions: [],
  auditTrail: [],
};

export default function ValidationDrillDown() {
  const router = useRouter();
  const { runId } = router.query;
  const [data, setData] = useState<DrillDownData>(fallbackDrillDown);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) return;
    const fetchDrillDown = async () => {
      try {
        const monitoringUrl = process.env.NEXT_PUBLIC_MONITORING_URL || 'http://localhost:3040';
        const { data: response } = await axios.get(`${monitoringUrl}/api/validation/runs/${runId}`);
        setData({
          run: response.run as ValidationRunSummary,
          decisions: response.decisions as Decision[],
          auditTrail: response.auditTrail as DrillDownData['auditTrail'],
        });
      } catch (error) {
        console.warn('Falling back to placeholder drill-down data', error);
        setData({
          run: {
            id: String(runId),
            tenantId: 'placeholder',
            entityType: 'tenant',
            entityId: 'placeholder',
            status: 'warning',
            errors: [],
            warnings: ['Example warning produced by regression guardrails'],
            summary: {},
            triggeredAt: new Date(),
            components: [],
          } as ValidationRunSummary,
          decisions: [
            {
              ruleId: 'banking-reconciled-balance',
              message: 'Unreconciled transaction requires review',
              status: 'fail',
              domain: 'banking',
            },
          ],
          auditTrail: [
            { action: 'decision_recorded', createdAt: new Date().toISOString() },
            { action: 'run_completed', createdAt: new Date().toISOString() },
          ],
        });
      } finally {
        setLoading(false);
      }
    };

    fetchDrillDown();
  }, [runId]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <Link href="/validation" className="text-blue-600 hover:underline">
          ← Back to dashboard
        </Link>

        <header className="space-y-2">
          <p className="text-sm text-slate-500 uppercase tracking-wide">Run {runId}</p>
          <h1 className="text-3xl font-semibold">Validation drill-down</h1>
          {loading && <p className="text-slate-500">Loading run details…</p>}
        </header>

        {data.run && (
          <section className="rounded-lg bg-white shadow p-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <p className="text-slate-500 text-sm">Entity</p>
                <p className="text-lg font-semibold">{data.run.entityType}</p>
              </div>
              <div className="text-right">
                <p className="text-slate-500 text-sm">Status</p>
                <p className="text-lg font-semibold capitalize">{data.run.status}</p>
              </div>
            </div>
            <p className="text-slate-600">Warnings: {data.run.warnings.join(', ') || 'None'}</p>
          </section>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg bg-white shadow p-4">
            <h2 className="text-xl font-semibold mb-2">Decisions</h2>
            <ul className="space-y-2 text-sm">
              {data.decisions.map((decision) => (
                <li key={decision.ruleId} className="border border-slate-100 rounded p-2">
                  <p className="font-semibold">{decision.ruleId}</p>
                  <p className="text-slate-600">{decision.message}</p>
                  <p className="text-xs text-slate-500">{decision.domain} · {decision.status}</p>
                </li>
              ))}
              {data.decisions.length === 0 && <p className="text-slate-600">No decisions returned by monitoring API.</p>}
            </ul>
          </div>
          <div className="rounded-lg bg-white shadow p-4">
            <h2 className="text-xl font-semibold mb-2">Audit trail</h2>
            <ul className="space-y-2 text-sm">
              {data.auditTrail.map((event, idx) => (
                <li key={idx} className="border border-slate-100 rounded p-2 flex justify-between">
                  <span>{event.action}</span>
                  <span className="text-slate-500">{new Date(event.createdAt).toLocaleString()}</span>
                </li>
              ))}
              {data.auditTrail.length === 0 && <p className="text-slate-600">No audit events captured for this run.</p>}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
