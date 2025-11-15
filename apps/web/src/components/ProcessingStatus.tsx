'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorRecovery from './ErrorRecovery';
import { ProcessingQueues } from '@ai-accountant/shared-types';

interface ProcessingStatusProps {
  token: string;
}

interface JobStatus {
  id: string;
  fileName: string;
  stage: 'document' | 'ocr' | 'classification' | 'ledger_posting' | 'completed';
  status: string;
  updatedAt: string;
  confidenceScore?: number | null;
  errorMessage?: string | null;
}

interface JobsResponse {
  jobs: JobStatus[];
}

interface QueueHealth {
  queueKey: string;
  queueName: string;
  enqueued: number;
  started: number;
  succeeded: number;
  failed: number;
  pending: number;
  inFlight: number;
  dlqDepth: number;
  lastError?: {
    message: string;
    documentId?: string;
    at?: string;
    service?: string;
  };
  lastEventAt?: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function ProcessingStatus({ token }: ProcessingStatusProps) {
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [queueHealth, setQueueHealth] = useState<QueueHealth[]>([]);
  const [queueHealthError, setQueueHealthError] = useState<string | null>(null);

  const queueLabels = useMemo<Record<string, string>>(() => ({
    [ProcessingQueues.OCR.primary]: 'OCR',
    [ProcessingQueues.CLASSIFICATION.primary]: 'Classification',
    [ProcessingQueues.LEDGER.primary]: 'Ledger Posting',
    OCR: 'OCR',
    CLASSIFICATION: 'Classification',
    LEDGER: 'Ledger Posting',
  }), []);

  const fetchJobs = useCallback(async () => {
    if (!token) return;
    try {
      setError(null);
      setLoading(true);
      const response = await fetch(`${API_BASE}/api/documents/status/jobs?limit=10`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error(`Status request failed with ${response.status}`);
      }
      const data = (await response.json()) as JobsResponse;
      setJobs(data.jobs);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load processing status');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const fetchQueueHealth = useCallback(async () => {
    if (!token) return;
    try {
      setQueueHealthError(null);
      const response = await fetch(`${API_BASE}/api/monitoring/queues/health`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error(`Queue health request failed with ${response.status}`);
      }
      const data = await response.json() as { queues: QueueHealth[] };
      setQueueHealth(data.queues);
    } catch (err) {
      console.error(err);
      setQueueHealthError(err instanceof Error ? err.message : 'Failed to load queue health');
    }
  }, [token]);

  useEffect(() => {
    fetchJobs();
    fetchQueueHealth();
    const interval = setInterval(() => {
      fetchJobs();
      fetchQueueHealth();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchJobs, fetchQueueHealth]);

  const handleRetry = useCallback(
    async (documentId: string) => {
      try {
        setRetryingId(documentId);
        setError(null);
        const response = await fetch(`${API_BASE}/api/documents/${documentId}/retry`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || `Retry failed with status ${response.status}`);
        }
        await fetchJobs();
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Failed to retry document');
      } finally {
        setRetryingId(null);
      }
    },
    [fetchJobs, token]
  );

  const getStageLabel = (stage: JobStatus['stage']) => {
    switch (stage) {
      case 'document':
        return 'Upload';
      case 'ocr':
        return 'OCR';
      case 'classification':
        return 'Classification';
      case 'ledger_posting':
        return 'Ledger Posting';
      case 'completed':
        return 'Posted';
      default:
        return stage;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'posted':
        return 'text-green-600 bg-green-100';
      case 'classified':
      case 'extracted':
        return 'text-blue-600 bg-blue-100';
      case 'error':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getQueueCardStatus = (health: QueueHealth) => {
    if (health.dlqDepth > 0) {
      return { label: 'Attention', className: 'text-red-700 bg-red-100 border border-red-200' };
    }
    if (health.pending > 25 || health.inFlight > 15) {
      return { label: 'Busy', className: 'text-amber-700 bg-amber-100 border border-amber-200' };
    }
    return { label: 'Healthy', className: 'text-green-700 bg-green-100 border border-green-200' };
  };

  const formatQueueLabel = (health: QueueHealth) => {
    return queueLabels[health.queueKey] || queueLabels[health.queueName] || health.queueKey || health.queueName;
  };

  return (
    <section className="bg-white rounded-lg shadow p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Processing Status</h2>
          <p className="text-sm text-gray-500">
            Latest document statuses across ingestion, OCR, classification, and posting.
          </p>
        </div>
        <button
          onClick={fetchJobs}
          className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {loading && jobs.length === 0 ? (
        <p className="text-gray-500">Loading processing status…</p>
      ) : jobs.length === 0 ? (
        <p className="text-gray-500">No recent documents to display.</p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div key={job.id} className="border rounded p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">{job.fileName}</p>
                  <p className="text-sm text-gray-500">
                    Stage: {getStageLabel(job.stage)} · Updated{' '}
                    {new Date(job.updatedAt).toLocaleTimeString('en-GB')}
                  </p>
                  {job.confidenceScore !== undefined && job.confidenceScore !== null && (
                    <p className="text-xs text-gray-500">Confidence: {(job.confidenceScore * 100).toFixed(0)}%</p>
                  )}
                </div>
                <span className={`px-2 py-1 rounded text-xs font-semibold ${getStatusColor(job.status)}`}>
                  {job.status}
                </span>
              </div>

              {job.status === 'error' && (
                <div className="mt-4">
                  <ErrorRecovery
                    error={{
                      type: 'processing',
                      message: job.errorMessage || 'Processing failed. Retry to continue.',
                      entityId: job.id,
                      entityType: job.stage,
                      retryable: true,
                    }}
                    onRetry={() => handleRetry(job.id)}
                    onDismiss={() => setJobs((prev) => prev.filter((p) => p.id !== job.id))}
                  />
                </div>
              )}

              {job.status !== 'error' && job.stage !== 'completed' && (
                <div className="mt-2">
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{
                        width: `${job.stage === 'document'
                          ? 20
                          : job.stage === 'ocr'
                            ? 40
                            : job.stage === 'classification'
                              ? 70
                              : job.stage === 'ledger_posting'
                                ? 90
                                : 100}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {job.stage === 'completed' ? 'Posted to ledger' : 'Processing'}
                  </p>
                </div>
              )}

              {job.status === 'error' && (
                <div className="flex justify-end">
                  <button
                    onClick={() => handleRetry(job.id)}
                    disabled={retryingId === job.id}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {retryingId === job.id ? 'Retrying…' : 'Retry'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

        <div className="mt-6 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Queue Health</h3>
              <p className="text-sm text-gray-500">
                Live telemetry from OCR, classification, and ledger workers.
              </p>
            </div>
            <button
              onClick={fetchQueueHealth}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
              disabled={loading}
            >
              Refresh
            </button>
          </div>
          {queueHealthError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {queueHealthError}
            </div>
          )}
          {queueHealth.length === 0 ? (
            <p className="text-gray-500 text-sm">Queue telemetry will appear as soon as jobs are running.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {queueHealth.map((health) => {
                const status = getQueueCardStatus(health);
                return (
                  <div key={health.queueKey} className="border rounded-lg p-4 h-full flex flex-col">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">{formatQueueLabel(health)}</p>
                        <p className="text-xs text-gray-500">
                          Pending {health.pending} · In-flight {health.inFlight}
                        </p>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-1 rounded-full ${status.className}`}>
                        {status.label}
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-gray-500">Enqueued</dt>
                        <dd className="font-medium text-gray-900">{health.enqueued}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Succeeded</dt>
                        <dd className="font-medium text-gray-900">{health.succeeded}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">Failed</dt>
                        <dd className="font-medium text-gray-900">{health.failed}</dd>
                      </div>
                      <div>
                        <dt className="text-gray-500">DLQ depth</dt>
                        <dd className="font-medium text-gray-900">{health.dlqDepth}</dd>
                      </div>
                    </dl>
                    {health.lastError && (
                      <p className="mt-3 text-xs text-red-600">
                        Last error: {health.lastError.message}
                        {health.lastError.documentId ? ` (${health.lastError.documentId})` : ''}
                      </p>
                    )}
                    {!health.lastError && health.lastEventAt && (
                      <p className="mt-3 text-xs text-gray-500">
                        Updated {new Date(health.lastEventAt).toLocaleTimeString('en-GB')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </section>
  );
}
