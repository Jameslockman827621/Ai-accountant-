'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('RetryQueue');

interface RetryJob {
  id: string;
  type: 'document_processing' | 'api_call' | 'webhook' | 'sync' | 'other';
  description: string;
  error: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface RetryQueueProps {
  token: string;
  onRetry?: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
}

export default function RetryQueue({ token, onRetry, onCancel }: RetryQueueProps) {
  const [jobs, setJobs] = useState<RetryJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'failed'>('pending');

  useEffect(() => {
    loadRetryQueue();
    const interval = setInterval(loadRetryQueue, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [filter]);

  const loadRetryQueue = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/retry-queue?filter=${filter}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load retry queue');

      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (error) {
      logger.error('Failed to load retry queue', error);
    } finally {
      setLoading(false);
    }
  };

  const retryNow = async (jobId: string) => {
    try {
      const response = await fetch(`/api/retry-queue/${jobId}/retry`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to retry job');

      if (onRetry) {
        onRetry(jobId);
      }
      await loadRetryQueue();
    } catch (error) {
      logger.error('Failed to retry job', error);
      alert('Failed to retry job');
    }
  };

  const cancelJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to cancel this retry job?')) return;

    try {
      const response = await fetch(`/api/retry-queue/${jobId}/cancel`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to cancel job');

      if (onCancel) {
        onCancel(jobId);
      }
      await loadRetryQueue();
    } catch (error) {
      logger.error('Failed to cancel job', error);
      alert('Failed to cancel job');
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'document_processing':
        return '📄';
      case 'api_call':
        return '🔌';
      case 'webhook':
        return '🔔';
      case 'sync':
        return '🔄';
      default:
        return '⚙️';
    }
  };

  const getStatusColor = (job: RetryJob) => {
    if (job.attempts >= job.maxAttempts) {
      return 'bg-red-50 border-red-200';
    }
    const nextRetry = new Date(job.nextRetryAt);
    const now = new Date();
    if (nextRetry <= now) {
      return 'bg-yellow-50 border-yellow-200';
    }
    return 'bg-blue-50 border-blue-200';
  };

  const pendingCount = jobs.filter(j => j.attempts < j.maxAttempts).length;
  const failedCount = jobs.filter(j => j.attempts >= j.maxAttempts).length;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold">Retry Queue</h2>
          {pendingCount > 0 && (
            <p className="text-sm text-gray-600 mt-1">
              {pendingCount} pending, {failedCount} failed
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
          <button
            onClick={loadRetryQueue}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && jobs.length === 0 ? (
        <div className="text-center py-8 text-gray-500">Loading retry queue...</div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p className="text-lg">✅ No jobs in retry queue</p>
          <p className="text-sm mt-2">All operations completed successfully!</p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div
              key={job.id}
              className={`p-4 rounded-lg border-2 ${getStatusColor(job)}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <span className="text-2xl">{getTypeIcon(job.type)}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{job.description}</h3>
                      {job.attempts >= job.maxAttempts && (
                        <span className="text-xs px-2 py-1 bg-red-200 text-red-900 rounded">
                          MAX ATTEMPTS
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-700 mb-2">{job.error}</p>
                    <div className="flex gap-4 text-xs text-gray-600">
                      <span>Attempts: {job.attempts}/{job.maxAttempts}</span>
                      {job.attempts < job.maxAttempts && (
                        <span>
                          Next retry: {new Date(job.nextRetryAt).toLocaleString()}
                        </span>
                      )}
                      <span>Created: {new Date(job.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  {job.attempts < job.maxAttempts && (
                    <button
                      onClick={() => retryNow(job.id)}
                      className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Retry Now
                    </button>
                  )}
                  <button
                    onClick={() => cancelJob(job.id)}
                    className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
