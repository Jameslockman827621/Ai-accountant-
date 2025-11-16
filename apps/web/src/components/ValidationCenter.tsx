'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ValidationStatus } from '@ai-accountant/shared-types';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface RunComponent {
  component: string;
  status: ValidationStatus;
  errors: string[];
  warnings: string[];
  metrics?: Record<string, unknown>;
}

interface ValidationRun {
  id: string;
  status: ValidationStatus;
  errors: string[];
  warnings: string[];
  triggeredAt: string;
  completedAt?: string;
  components: RunComponent[];
}

interface ValidationCenterProps {
  token: string;
}

export default function ValidationCenter({ token }: ValidationCenterProps) {
  const [run, setRun] = useState<ValidationRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const statusStyles: Record<ValidationStatus, string> = useMemo(
    () => ({
      pass: 'bg-green-100 text-green-800 border border-green-200',
      warning: 'bg-amber-100 text-amber-800 border border-amber-200',
      fail: 'bg-red-100 text-red-800 border border-red-200',
    }),
    []
  );

  const fetchLatest = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/api/validation/runs/latest?entityType=tenant&entityId=self`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (response.status === 404) {
        setRun(null);
        setLoading(false);
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to load validation status');
      }
      const data = await response.json();
      setRun(data.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load validation status');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const triggerRun = useCallback(async () => {
    if (!token) return;
    setRunning(true);
    setStatusMessage('Starting validation checks…');
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/validation/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          entityType: 'tenant',
          entityId: 'self',
          includeConfidenceChecks: true,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Validation run failed to start');
      }
      const summary = await response.json();
      setStatusMessage(`Validation checks complete (status: ${summary.status?.toUpperCase?.() || 'PASS'})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start validation checks');
    } finally {
      setRunning(false);
      fetchLatest().catch(() => undefined);
    }
  }, [token, fetchLatest]);

  useEffect(() => {
    fetchLatest().catch(() => undefined);
  }, [fetchLatest]);

  const renderComponentCard = (component: RunComponent) => {
    const statusClass = statusStyles[component.status];
    return (
      <div
        key={component.component}
        className={`rounded-2xl border bg-white p-4 flex flex-col gap-2 ${statusClass}`}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold capitalize">{component.component}</p>
          <span className="text-xs font-semibold uppercase">{component.status}</span>
        </div>
        {component.errors.length > 0 && (
          <ul className="text-xs text-red-800 list-disc ml-4">
            {component.errors.map(error => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
        {component.errors.length === 0 && component.warnings.length > 0 && (
          <ul className="text-xs text-amber-800 list-disc ml-4">
            {component.warnings.map(warning => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        {component.metrics && Object.keys(component.metrics).length > 0 && (
          <dl className="grid grid-cols-2 gap-y-1 text-xs text-gray-700">
            {Object.entries(component.metrics).map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <dt className="capitalize">{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    );
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-semibold text-blue-600 uppercase">Data validation</p>
          <h2 className="text-2xl font-semibold text-gray-900">Validation & Accuracy Center</h2>
          <p className="text-sm text-gray-500">
            Run automated tax, accuracy, anomaly, and confidence checks before filing or closing periods.
          </p>
        </div>
        <button
          type="button"
          onClick={triggerRun}
          disabled={running}
          className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:bg-blue-300"
        >
          {running ? 'Running…' : 'Run full validation'}
        </button>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">
          {statusMessage}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900">{error}</div>
      )}

      {loading ? (
        <p className="text-sm text-gray-500">Loading validation status…</p>
      ) : !run ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm text-gray-500">
          No validation run recorded yet. Start one to generate confidence before filing.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-500">Overall status</p>
              <p
                className={`inline-flex items-center rounded-full px-4 py-1 text-sm font-semibold ${statusStyles[run.status]}`}
              >
                {run.status.toUpperCase()}
              </p>
            </div>
            <div className="text-xs text-gray-500 space-y-1 text-right">
              <p>Triggered {new Date(run.triggeredAt).toLocaleString()}</p>
              {run.completedAt && <p>Completed {new Date(run.completedAt).toLocaleString()}</p>}
            </div>
          </div>

          {(run.errors.length > 0 || run.warnings.length > 0) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-2">
              {run.errors.map(errorMessage => (
                <p key={errorMessage}>⚠️ {errorMessage}</p>
              ))}
              {run.warnings.map(warning => (
                <p key={warning}>ℹ️ {warning}</p>
              ))}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {run.components.map(renderComponentCard)}
          </div>
        </>
      )}
    </section>
  );
}
