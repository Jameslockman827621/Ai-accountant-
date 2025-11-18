'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  DocumentArrowDownIcon,
  LockClosedIcon,
  LockOpenIcon,
} from '@heroicons/react/24/outline';

interface CloseTask {
  id: string;
  taskType: string;
  taskName: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped';
  assignedTo?: string;
  dueDate?: string;
  completedAt?: string;
  blockerReason?: string;
  resultData?: Record<string, unknown>;
}

interface PeriodClose {
  id: string;
  periodStart: string;
  periodEnd: string;
  closeStatus: 'draft' | 'in_progress' | 'locked' | 'closed' | 'reopened';
  lockedAt?: string;
  lockedBy?: string;
  closedAt?: string;
  closedBy?: string;
  checklist: Record<string, boolean>;
  validationResults: Record<string, unknown>;
  varianceAlerts: Array<{
    type: string;
    accountCode?: string;
    thresholdAmount?: number;
    actualAmount?: number;
    varianceAmount?: number;
    severity: string;
  }>;
  requiredAttachments: string[];
  generatedReports: string[];
  exportPackageLocation?: string;
}

interface CloseChecklistProps {
  token: string;
  closeId?: string;
  periodStart?: Date;
  periodEnd?: Date;
  entityId?: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function CloseChecklist({
  token,
  closeId,
  periodStart,
  periodEnd,
  entityId,
}: CloseChecklistProps) {
  const [close, setClose] = useState<PeriodClose | null>(null);
  const [tasks, setTasks] = useState<CloseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  useEffect(() => {
    if (closeId) {
      fetchCloseData(closeId);
    } else if (periodStart && periodEnd) {
      createOrGetClose();
    }
  }, [closeId, periodStart, periodEnd, entityId]);

  async function createOrGetClose() {
    try {
      const res = await fetch(`${API_BASE}/api/ledger/period-close`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          periodStart: periodStart?.toISOString().split('T')[0],
          periodEnd: periodEnd?.toISOString().split('T')[0],
          entityId,
        }),
      });

      if (!res.ok) throw new Error('Failed to create/get period close');

      const data = await res.json() as { close: PeriodClose };
      setClose(data.close);
      await fetchTasks(data.close.id);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load period close');
    } finally {
      setLoading(false);
    }
  }

  async function fetchCloseData(id: string) {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/ledger/period-close/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Failed to fetch period close');

      const data = await res.json() as { close: PeriodClose };
      setClose(data.close);
      await fetchTasks(id);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load period close');
    } finally {
      setLoading(false);
    }
  }

  async function fetchTasks(closeId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/ledger/period-close/${closeId}/tasks`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Failed to fetch tasks');

      const data = await res.json() as { tasks: CloseTask[] };
      setTasks(data.tasks || []);
    } catch (err) {
      console.error(err);
    }
  }

  async function startClose() {
    if (!close) return;

    try {
      const res = await fetch(`${API_BASE}/api/ledger/period-close/${close.id}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Failed to start close');

      await fetchCloseData(close.id);
    } catch (err) {
      console.error(err);
      alert('Failed to start close');
    }
  }

  async function executeTasks() {
    if (!close) return;

    try {
      const res = await fetch(`${API_BASE}/api/ledger/period-close/${close.id}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Failed to execute tasks');

      await fetchCloseData(close.id);
      await fetchTasks(close.id);
    } catch (err) {
      console.error(err);
      alert('Failed to execute tasks');
    }
  }

  async function lockPeriod() {
    if (!close) return;

    try {
      const res = await fetch(`${API_BASE}/api/ledger/period-close/${close.id}/lock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Failed to lock period');

      await fetchCloseData(close.id);
    } catch (err) {
      console.error(err);
      alert('Failed to lock period');
    }
  }

  async function completeClose() {
    if (!close) return;

    if (!confirm('Are you sure you want to close this period? This action cannot be undone.')) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/ledger/period-close/${close.id}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) throw new Error('Failed to complete close');

      await fetchCloseData(close.id);
    } catch (err) {
      console.error(err);
      alert('Failed to complete close');
    }
  }

  async function exportPackage() {
    if (!close) return;

    try {
      const res = await fetch(`${API_BASE}/api/ledger/period-close/${close.id}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error('Failed to export package');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `close-package-${close.periodStart}-${close.periodEnd}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Failed to export package');
    }
  }

  type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

  const progress = useMemo(() => {
    if (tasks.length === 0) return 0;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    return (completed / tasks.length) * 100;
  }, [tasks]);

  const tasksByStatus = useMemo<Record<TaskStatus, CloseTask[]>>(() => {
    return {
      pending: tasks.filter((t) => t.status === 'pending'),
      in_progress: tasks.filter((t) => t.status === 'in_progress'),
      completed: tasks.filter((t) => t.status === 'completed'),
      blocked: tasks.filter((t) => t.status === 'blocked'),
    };
  }, [tasks]);

  if (loading && !close) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-4 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!close) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center text-gray-500">
          {error || 'No period close found. Please create one first.'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold">Period Close</h2>
            <div className="text-sm text-gray-500 mt-1">
              {new Date(close.periodStart).toLocaleDateString()} -{' '}
              {new Date(close.periodEnd).toLocaleDateString()}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {close.closeStatus === 'locked' ? (
              <LockClosedIcon className="h-6 w-6 text-red-600" />
            ) : (
              <LockOpenIcon className="h-6 w-6 text-gray-400" />
            )}
            <span className="px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700">
              {close.closeStatus.replace('_', ' ').toUpperCase()}
            </span>
          </div>
        </div>

        {/* Progress Meter */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Progress</span>
            <span className="text-sm text-gray-500">{progress.toFixed(0)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className="bg-blue-600 h-3 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {close.closeStatus === 'draft' && (
            <button
              onClick={startClose}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Start Close
            </button>
          )}
          {close.closeStatus === 'in_progress' && (
            <>
              <button
                onClick={executeTasks}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                Execute Tasks
              </button>
              <button
                onClick={lockPeriod}
                className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
              >
                Lock Period
              </button>
            </>
          )}
          {close.closeStatus === 'locked' && (
            <button
              onClick={completeClose}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Complete Close
            </button>
          )}
          {close.exportPackageLocation && (
            <button
              onClick={exportPackage}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center gap-2"
            >
              <DocumentArrowDownIcon className="h-5 w-5" />
              Export Package
            </button>
          )}
        </div>
      </div>

      {/* Variance Alerts */}
      {close.varianceAlerts.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600" />
            <h3 className="font-semibold text-yellow-800">Variance Alerts</h3>
          </div>
          <div className="space-y-2">
            {close.varianceAlerts.map((alert, idx) => (
              <div key={idx} className="text-sm text-yellow-700">
                <span className="font-medium">{alert.type.replace('_', ' ')}:</span>{' '}
                {alert.accountCode && `Account ${alert.accountCode} - `}
                Variance of {alert.varianceAmount?.toLocaleString('en-GB', {
                  style: 'currency',
                  currency: 'GBP',
                })}{' '}
                ({alert.severity})
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {(['pending', 'in_progress', 'completed', 'blocked'] as const).map((status) => (
          <div key={status} className="bg-white rounded-lg shadow">
            <div className="p-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold capitalize">{status.replace('_', ' ')}</h3>
                <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">
                  {tasksByStatus[status].length}
                </span>
              </div>
            </div>
            <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
              {tasksByStatus[status].map((task) => (
                <div
                  key={task.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedTask === task.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => setSelectedTask(selectedTask === task.id ? null : task.id)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{task.taskName}</div>
                      <div className="text-xs text-gray-500 mt-1">{task.taskType}</div>
                    </div>
                    {task.status === 'completed' ? (
                      <CheckCircleIcon className="h-5 w-5 text-green-600 flex-shrink-0" />
                    ) : task.status === 'blocked' ? (
                      <XCircleIcon className="h-5 w-5 text-red-600 flex-shrink-0" />
                    ) : task.status === 'in_progress' ? (
                      <ClockIcon className="h-5 w-5 text-yellow-600 flex-shrink-0" />
                    ) : null}
                  </div>
                  {task.assignedTo && (
                    <div className="text-xs text-gray-500 mt-1">Assigned to: {task.assignedTo}</div>
                  )}
                  {task.dueDate && (
                    <div className="text-xs text-gray-500 mt-1">
                      Due: {new Date(task.dueDate).toLocaleDateString()}
                    </div>
                  )}
                  {task.blockerReason && (
                    <div className="text-xs text-red-600 mt-2 p-2 bg-red-50 rounded">
                      {task.blockerReason}
                    </div>
                  )}
                  {selectedTask === task.id && task.resultData && (
                    <div className="mt-2 p-2 bg-gray-50 rounded text-xs">
                      <div className="font-medium mb-1">Result:</div>
                      <pre className="text-xs overflow-auto">
                        {JSON.stringify(task.resultData, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
              {tasksByStatus[status].length === 0 && (
                <div className="text-center text-gray-400 text-sm py-8">No tasks</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Generated Reports */}
      {close.generatedReports.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-3">Generated Reports</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {close.generatedReports.map((report, idx) => (
              <button
                key={idx}
                className="px-3 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors text-sm"
              >
                {typeof report === 'object' ? (report as { type: string }).type : report}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">{error}</div>
      )}
    </div>
  );
}
