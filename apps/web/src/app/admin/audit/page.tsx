'use client';

import { useEffect, useMemo, useState } from 'react';

interface AccessLog {
  id: string;
  actorId: string;
  action: string;
  status: 'allowed' | 'denied';
  resource?: string;
  traceId?: string;
  message?: string;
  createdAt: string;
}

interface ApprovalStep {
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  approvedBy?: string;
  approvedAt?: string;
  note?: string;
}

interface ApprovalRequest {
  id: string;
  action: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  createdAt: string;
  steps: ApprovalStep[];
  reason?: string;
}

interface AccessPolicy {
  id: string;
  action: string;
  allowedRoles: string[];
  approvalChainId?: string;
  risk: string;
  description: string;
}

interface ApprovalChain {
  id: string;
  name: string;
  description: string;
  steps: { role: string; minimumApprovals?: number; note?: string }[];
}

const cardStyles = 'rounded-lg border border-gray-200 bg-white p-4 shadow-sm';

export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [policies, setPolicies] = useState<AccessPolicy[]>([]);
  const [chains, setChains] = useState<ApprovalChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pendingApprovals = useMemo(() => approvals.filter((a) => a.status === 'pending').length, [approvals]);

  const fetchWithAuth = async (path: string, options?: RequestInit) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const response = await fetch(path, { ...options, headers });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Request failed: ${response.status}`);
    }
    return response.json();
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [logsResult, approvalsResult, policiesResult] = await Promise.all([
        fetchWithAuth('/api/audit/access-logs'),
        fetchWithAuth('/api/audit/approvals'),
        fetchWithAuth('/api/audit/policies'),
      ]);

      setLogs(logsResult.logs || []);
      setApprovals(approvalsResult.approvals || []);
      setPolicies(policiesResult.policies || []);
      setChains(policiesResult.approvalChains || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load audit data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const approve = async (approvalId: string) => {
    try {
      await fetchWithAuth(`/api/audit/approvals/${approvalId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ approved: true, note: 'Approved from admin console' }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to approve request');
    }
  };

  const requestApproval = async (action: string) => {
    try {
      await fetchWithAuth('/api/audit/approvals', {
        method: 'POST',
        body: JSON.stringify({ action, reason: 'Triggered from admin audit console' }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to open approval request');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-blue-700">Security & Compliance</p>
          <h1 className="text-2xl font-bold text-gray-900">Admin audit console</h1>
          <p className="text-sm text-gray-600">
            View access lineage, enforce RBAC policies, and shepherd approval chains for privileged actions.
          </p>
        </div>
        <button
          onClick={refresh}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className={cardStyles}>
          <p className="text-xs uppercase tracking-wide text-gray-500">Access logs</p>
          <p className="text-3xl font-semibold text-gray-900">{logs.length}</p>
          <p className="text-sm text-gray-600">Recent policy decisions recorded for this tenant</p>
        </div>
        <div className={cardStyles}>
          <p className="text-xs uppercase tracking-wide text-gray-500">Pending approvals</p>
          <p className="text-3xl font-semibold text-gray-900">{pendingApprovals}</p>
          <p className="text-sm text-gray-600">Awaiting sign-off in defined approval chains</p>
        </div>
        <div className={cardStyles}>
          <p className="text-xs uppercase tracking-wide text-gray-500">Policies loaded</p>
          <p className="text-3xl font-semibold text-gray-900">{policies.length}</p>
          <p className="text-sm text-gray-600">RBAC and approval chain definitions in force</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className={`${cardStyles} h-full`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Access activity</h2>
                <p className="text-sm text-gray-600">Trace IDs and policy outcomes for protected routes</p>
              </div>
              {loading && <span className="text-xs text-gray-500">Loading…</span>}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">When</th>
                    <th className="px-3 py-2">Actor</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Trace</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-sm text-gray-500" colSpan={5}>
                        No access events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="border-b last:border-none">
                        <td className="px-3 py-2 text-gray-900">{new Date(log.createdAt).toLocaleString()}</td>
                        <td className="px-3 py-2 text-gray-700">{log.actorId}</td>
                        <td className="px-3 py-2 text-gray-700">{log.action}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              log.status === 'allowed'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {log.status}
                          </span>
                          {log.message && <p className="text-xs text-gray-500">{log.message}</p>}
                        </td>
                        <td className="px-3 py-2 text-xs text-blue-700">{log.traceId ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section>
          <div className={cardStyles}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Admin controls</h2>
                <p className="text-sm text-gray-600">Trigger approvals or fast-track urgent reviews</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {policies.map((policy) => (
                <div key={policy.id} className="rounded-md border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{policy.action}</p>
                      <p className="text-xs text-gray-600">{policy.description}</p>
                    </div>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
                      Risk: {policy.risk}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    <span className="font-medium text-gray-700">Roles:</span>
                    {policy.allowedRoles.map((role) => (
                      <span key={role} className="rounded bg-blue-50 px-2 py-1 text-blue-800">
                        {role}
                      </span>
                    ))}
                    {policy.approvalChainId && (
                      <span className="rounded bg-amber-50 px-2 py-1 text-amber-800">
                        Chain: {policy.approvalChainId}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => requestApproval(policy.action)}
                      className="rounded-md bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                    >
                      Request approval
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className={cardStyles}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Approval queue</h2>
            <p className="text-sm text-gray-600">Track progress through each approval chain</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Requested</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Steps</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {approvals.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-gray-500" colSpan={5}>
                    No approval requests have been opened.
                  </td>
                </tr>
              ) : (
                approvals.map((approval) => (
                  <tr key={approval.id} className="border-b last:border-none">
                    <td className="px-3 py-2 text-gray-900">{new Date(approval.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-gray-700">{approval.action}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          approval.status === 'approved'
                            ? 'bg-green-100 text-green-800'
                            : approval.status === 'rejected'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {approval.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700">
                      <div className="space-y-1">
                        {approval.steps.map((step, index) => (
                          <div key={`${approval.id}-${step.role}-${index}`} className="flex items-center gap-2">
                            <span className="font-medium text-gray-800">{step.role}</span>
                            <span
                              className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                                step.status === 'approved'
                                  ? 'bg-green-100 text-green-700'
                                  : step.status === 'rejected'
                                    ? 'bg-red-100 text-red-700'
                                    : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {step.status}
                            </span>
                            {step.approvedBy && <span className="text-gray-500">by {step.approvedBy}</span>}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {approval.status === 'pending' && (
                        <button
                          onClick={() => approve(approval.id)}
                          className="rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700"
                        >
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={cardStyles}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Approval chains</h2>
            <p className="text-sm text-gray-600">Who must sign off and in what order</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {chains.map((chain) => (
            <div key={chain.id} className="rounded-md border border-gray-200 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{chain.name}</p>
                  <p className="text-xs text-gray-600">{chain.description}</p>
                </div>
                <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-700">{chain.id}</span>
              </div>
              <ol className="mt-3 list-decimal space-y-1 pl-4 text-xs text-gray-700">
                {chain.steps.map((step, index) => (
                  <li key={`${chain.id}-${step.role}-${index}`}>
                    <span className="font-semibold text-gray-900">{step.role}</span>
                    {step.minimumApprovals ? ` · ${step.minimumApprovals} approval(s)` : ''}
                    {step.note ? ` — ${step.note}` : ''}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
