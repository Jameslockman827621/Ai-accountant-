'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

type ClientStatus = 'active' | 'inactive' | 'pending';
type BulkOperation = 'approve' | 'reject' | 'export' | 'categorize';

interface AccountantClientsPanelProps {
  token: string;
}

interface ClientSummary {
  tenantId: string;
  name: string;
  status: ClientStatus;
  lastActivity: string | null;
  revenue: number;
  expenses: number;
  profit: number;
  upcomingDeadlines: number;
  pendingTasks: number;
}

interface BulkOperationResult {
  success: number;
  failed: number;
  errors: Array<{ tenantId: string; error: string }>;
}

type TaskAction = 'approve' | 'reject' | 'needs_revision';

interface ClientTask {
  id: string;
  tenantId: string;
  entityType: 'document' | 'ledger_entry' | 'filing' | 'transaction';
  entityId: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected' | 'needs_revision';
  createdAt: string;
  summary?: string | null;
}

const BULK_OPERATIONS: Array<{ value: BulkOperation; label: string }> = [
  { value: 'approve', label: 'Approve pending filings' },
  { value: 'reject', label: 'Reject pending filings' },
  { value: 'export', label: 'Prepare export package' },
  { value: 'categorize', label: 'Trigger auto-categorization' },
];

export default function AccountantClientsPanel({ token }: AccountantClientsPanelProps) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOperation, setBulkOperation] = useState<BulkOperation>('approve');
  const [runningOperation, setRunningOperation] = useState(false);
  const [switchingTenantId, setSwitchingTenantId] = useState<string | null>(null);
  const [expandedTenantId, setExpandedTenantId] = useState<string | null>(null);
  const [clientTasks, setClientTasks] = useState<ClientTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  const headers = useMemo<HeadersInit>(
    () => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }),
    [token]
  );

  const fetchClients = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setActionError(null);
      setActionMessage(null);
      const response = await fetch(`${API_BASE}/api/accountant/clients`, {
        headers,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || 'Failed to fetch clients');
      }
      const data = (await response.json()) as { clients: ClientSummary[] };
      setClients(data.clients || []);
      setSelected(new Set());
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Unable to fetch accountant clients');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    void fetchClients();
  }, [fetchClients]);

  const toggleSelection = (tenantId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(tenantId)) {
        next.delete(tenantId);
      } else {
        next.add(tenantId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === clients.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(clients.map(client => client.tenantId)));
  };

  const handleSwitchContext = async (tenantId: string) => {
    try {
      setSwitchingTenantId(tenantId);
      setActionError(null);
      const response = await fetch(`${API_BASE}/api/accountant/switch-context`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tenantId }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || 'Failed to switch tenant context');
      }
      setActionMessage('Context switched – your next actions will target that client.');
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : 'Unable to switch context');
    } finally {
      setSwitchingTenantId(null);
    }
  };

  const runBulkOperation = async () => {
    if (selected.size === 0) {
      setActionError('Select at least one client before running a bulk action.');
      return;
    }
    try {
      setRunningOperation(true);
      setActionError(null);
      setActionMessage(null);
      const response = await fetch(`${API_BASE}/api/accountant/bulk-operation`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tenantIds: Array.from(selected),
          operation: bulkOperation,
          parameters: {},
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || 'Failed to run bulk operation');
      }
      const data = (await response.json()) as BulkOperationResult;
      setActionMessage(
        `Bulk action completed – ${data.success} succeeded, ${data.failed} failed${
          data.failed > 0 ? '. Check logs for details.' : '.'
        }`
      );
      await fetchClients();
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : 'Bulk operation failed');
    } finally {
      setRunningOperation(false);
    }
  };

  const fetchTasksForTenant = useCallback(
    async (tenantId: string) => {
      try {
        setTasksLoading(true);
        setTasksError(null);
        setClientTasks([]);
        const response = await fetch(`${API_BASE}/api/accountant/clients/${tenantId}/tasks`, {
          headers,
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || 'Failed to load client tasks');
        }
        const data = (await response.json()) as { tasks: ClientTask[] };
        setClientTasks(
          (data.tasks || []).map(task => ({
            ...task,
            createdAt: task.createdAt,
          }))
        );
      } catch (err) {
        console.error(err);
        setTasksError(err instanceof Error ? err.message : 'Unable to load client tasks');
      } finally {
        setTasksLoading(false);
      }
    },
    [headers]
  );

  const toggleTasks = (tenantId: string) => {
    if (expandedTenantId === tenantId) {
      setExpandedTenantId(null);
      setClientTasks([]);
      setTasksError(null);
      return;
    }
    setExpandedTenantId(tenantId);
    void fetchTasksForTenant(tenantId);
  };

  const handleTaskAction = async (tenantId: string, taskId: string, action: TaskAction) => {
    try {
      setUpdatingTaskId(taskId);
      setActionError(null);
      const response = await fetch(
        `${API_BASE}/api/accountant/clients/${tenantId}/tasks/${taskId}/resolve`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ action }),
        }
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || 'Failed to update task');
      }
      setActionMessage(`Task ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'sent for revision'}.`);
      await fetchClients();
      await fetchTasksForTenant(tenantId);
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : 'Unable to update task');
    } finally {
      setUpdatingTaskId(null);
    }
  };

  const totalAUM = clients.reduce(
    (totals, client) => {
      return {
        revenue: totals.revenue + client.revenue,
        profit: totals.profit + client.profit,
        tasks: totals.tasks + client.pendingTasks,
      };
    },
    { revenue: 0, profit: 0, tasks: 0 }
  );

  return (
    <section className="rounded-lg bg-white p-6 shadow space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Accountant Clients</h3>
          <p className="text-sm text-gray-500">
            Monitor every client workspace, switch context, and run bulk approvals from one view.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => fetchClients()}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
          <div className="flex items-center gap-2">
            <select
              value={bulkOperation}
              onChange={event => setBulkOperation(event.target.value as BulkOperation)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              {BULK_OPERATIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              onClick={runBulkOperation}
              disabled={runningOperation}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {runningOperation ? 'Running…' : 'Run bulk action'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {actionError && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div className="rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {actionMessage}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SummaryCard label="Managed revenue (12m)" value={`£${totalAUM.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`} />
        <SummaryCard label="Aggregate profit" value={`£${totalAUM.profit.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`} trend={totalAUM.profit >= 0 ? 'up' : 'down'} />
        <SummaryCard label="Open tasks" value={totalAUM.tasks.toLocaleString()} />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.size === clients.length && clients.length > 0}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Revenue</th>
              <th className="px-3 py-2 text-right">Profit</th>
              <th className="px-3 py-2 text-center">Deadlines</th>
              <th className="px-3 py-2 text-center">Tasks</th>
              <th className="px-3 py-2 text-left">Last activity</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-gray-500">
                  Loading accountant clients…
                </td>
              </tr>
            )}
            {!loading && clients.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-gray-500">
                  No client workspaces found for this account.
                </td>
              </tr>
            )}
            {clients.map(client => (
              <tr key={client.tenantId} className="text-gray-700">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(client.tenantId)}
                    onChange={() => toggleSelection(client.tenantId)}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium text-gray-900">{client.name}</div>
                  <div className="text-xs text-gray-500">{client.tenantId}</div>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={client.status} />
                </td>
                <td className="px-3 py-2 text-right">
                  £{client.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2 text-right">
                  £{client.profit.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                </td>
                <td className="px-3 py-2 text-center">{client.upcomingDeadlines}</td>
                <td className="px-3 py-2 text-center">{client.pendingTasks}</td>
                <td className="px-3 py-2">
                  {client.lastActivity
                    ? new Date(client.lastActivity).toLocaleString('en-GB')
                    : 'No activity'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => handleSwitchContext(client.tenantId)}
                    disabled={switchingTenantId === client.tenantId}
                    className="mr-2 rounded border border-gray-300 px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                  >
                    {switchingTenantId === client.tenantId ? 'Switching…' : 'Switch context'}
                  </button>
                  <button
                    onClick={() => toggleTasks(client.tenantId)}
                    className="rounded border border-blue-200 px-3 py-1 text-xs text-blue-700 hover:bg-blue-50"
                  >
                    {expandedTenantId === client.tenantId ? 'Hide tasks' : 'View tasks'}
                  </button>
                </td>
              </tr>
              {expandedTenantId === client.tenantId && (
                <tr className="bg-gray-50">
                  <td colSpan={9} className="px-3 py-3">
                    {tasksLoading ? (
                      <p className="text-sm text-gray-500">Loading tasks…</p>
                    ) : tasksError ? (
                      <p className="text-sm text-red-600">{tasksError}</p>
                    ) : clientTasks.length === 0 ? (
                      <p className="text-sm text-gray-500">No pending tasks for this client.</p>
                    ) : (
                      <div className="space-y-2">
                        {clientTasks.map(task => (
                          <div
                            key={task.id}
                            className="flex flex-col gap-2 rounded border border-gray-200 bg-white p-3 md:flex-row md:items-center md:justify-between"
                          >
                            <div>
                              <p className="text-sm font-semibold text-gray-900">
                                {task.summary || `${task.entityType} task`}
                              </p>
                              <p className="text-xs text-gray-500">
                                Created {new Date(task.createdAt).toLocaleString('en-GB')} ·{' '}
                                <span className="capitalize">{task.entityType}</span>
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <PriorityChip priority={task.priority} />
                              <button
                                onClick={() => handleTaskAction(client.tenantId, task.id, 'approve')}
                                disabled={updatingTaskId === task.id}
                                className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-60"
                              >
                                {updatingTaskId === task.id ? 'Saving…' : 'Approve'}
                              </button>
                              <button
                                onClick={() => handleTaskAction(client.tenantId, task.id, 'reject')}
                                disabled={updatingTaskId === task.id}
                                className="rounded border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                              >
                                Reject
                              </button>
                              <button
                                onClick={() => handleTaskAction(client.tenantId, task.id, 'needs_revision')}
                                disabled={updatingTaskId === task.id}
                                className="rounded border border-amber-300 px-3 py-1 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                              >
                                Needs revision
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              )}
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: ClientStatus }) {
  const styles: Record<ClientStatus, string> = {
    active: 'bg-green-100 text-green-700',
    inactive: 'bg-gray-100 text-gray-600',
    pending: 'bg-amber-100 text-amber-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string | number;
  trend?: 'up' | 'down';
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900">{value}</p>
      {trend && (
        <p className={`text-xs ${trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
          {trend === 'up' ? '▲ Positive trend' : '▼ Negative trend'}
        </p>
      )}
    </div>
  );
}

function PriorityChip({ priority }: { priority: 'low' | 'medium' | 'high' }) {
  const styles: Record<'low' | 'medium' | 'high', string> = {
    low: 'bg-gray-100 text-gray-700',
    medium: 'bg-amber-100 text-amber-800',
    high: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${styles[priority]}`}>
      {priority} priority
    </span>
  );
}
