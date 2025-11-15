'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

type PlaybookStatus = 'draft' | 'active' | 'paused';
type PlaybookRunStatus = 'success' | 'failed' | 'skipped' | 'awaiting_approval';

interface PlaybookTemplateField {
  key: string;
  label: string;
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  helperText?: string;
}

interface PlaybookTemplate {
  key: string;
  name: string;
  description: string;
  configFields: PlaybookTemplateField[];
  defaultConfig: Record<string, number>;
  category: string;
  confirmationRequired?: boolean;
  metrics: string[];
  callToAction: string;
}

interface Playbook {
  id: string;
  templateKey: string;
  name: string;
  description?: string | null;
  status: PlaybookStatus;
  config: Record<string, unknown>;
  cadenceMinutes: number;
  confirmationRequired: boolean;
  lastRunAt: string | null;
  lastRunStatus: PlaybookRunStatus | null;
  lastRunSummary: Record<string, unknown>;
  pendingApprovals: number;
}

interface PlaybookRun {
  id: string;
  status: PlaybookRunStatus;
  triggeredBy: string;
  message: string | null;
  createdAt: string;
  completedAt: string | null;
  context: Record<string, unknown>;
  actionSummary: Record<string, unknown>;
}

interface AutomationPlaybooksPanelProps {
  token: string;
}

export default function AutomationPlaybooksPanel({ token }: AutomationPlaybooksPanelProps) {
  const [templates, setTemplates] = useState<PlaybookTemplate[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<PlaybookTemplate | null>(null);
  const [templateConfig, setTemplateConfig] = useState<Record<string, number>>({});
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, PlaybookRun[]>>({});
  const [runsLoading, setRunsLoading] = useState<Record<string, boolean>>({});
  const [expandedPlaybookId, setExpandedPlaybookId] = useState<string | null>(null);
  const [runningPlaybookId, setRunningPlaybookId] = useState<string | null>(null);

  const authenticatedHeaders = useMemo<HeadersInit>(
    () => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }),
    [token]
  );

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/automation/playbooks/templates`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('Failed to load playbook templates');
      }
      const data = (await res.json()) as { templates: PlaybookTemplate[] };
      setTemplates(data.templates || []);
    } catch (err) {
      console.error(err);
    }
  }, [token]);

  const fetchPlaybooks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/api/automation/playbooks`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error('Failed to load playbooks');
      }
      const data = (await res.json()) as { playbooks: Playbook[] };
      setPlaybooks(data.playbooks || []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load automation playbooks');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchTemplates();
    void fetchPlaybooks();
  }, [fetchPlaybooks, fetchTemplates]);

  const handleSelectTemplate = (template: PlaybookTemplate) => {
    setPendingTemplate(template);
    setTemplateConfig(template.defaultConfig || {});
    setActionMessage(null);
    setActionError(null);
  };

  const handleCreatePlaybook = async () => {
    if (!pendingTemplate) return;
    try {
      setSavingTemplate(true);
      setActionError(null);
      const response = await fetch(`${API_BASE}/api/automation/playbooks`, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify({
          templateKey: pendingTemplate.key,
          config: templateConfig,
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || 'Failed to create playbook');
      }
      setActionMessage(`${pendingTemplate.name} added to your workspace`);
      setPendingTemplate(null);
      await fetchPlaybooks();
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : 'Unable to create playbook');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleToggleStatus = async (playbook: Playbook) => {
    const nextStatus: PlaybookStatus = playbook.status === 'active' ? 'paused' : 'active';
    try {
      setActionError(null);
      setActionMessage(null);
      await fetch(`${API_BASE}/api/automation/playbooks/${playbook.id}`, {
        method: 'PATCH',
        headers: authenticatedHeaders,
        body: JSON.stringify({ status: nextStatus }),
      });
      setActionMessage(`Playbook ${nextStatus === 'active' ? 'activated' : 'paused'}`);
      await fetchPlaybooks();
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : 'Failed to update playbook');
    }
  };

  const handleRunPlaybook = async (playbook: Playbook, force?: boolean) => {
    try {
      setRunningPlaybookId(playbook.id);
      setActionError(null);
      setActionMessage(null);
      const res = await fetch(`${API_BASE}/api/automation/playbooks/${playbook.id}/run`, {
        method: 'POST',
        headers: authenticatedHeaders,
        body: JSON.stringify({ force: Boolean(force) }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || 'Failed to run playbook');
      }
      const data = (await res.json()) as { run: PlaybookRun };
      setActionMessage(
        data.run.status === 'awaiting_approval'
          ? 'Playbook queued and awaiting approval'
          : 'Playbook executed'
      );
      await fetchPlaybooks();
      if (expandedPlaybookId === playbook.id) {
        await loadRuns(playbook.id);
      }
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : 'Failed to run playbook');
    } finally {
      setRunningPlaybookId(null);
    }
  };

  const loadRuns = useCallback(
    async (playbookId: string) => {
      try {
        setRunsLoading(prev => ({ ...prev, [playbookId]: true }));
        const res = await fetch(`${API_BASE}/api/automation/playbooks/${playbookId}/runs`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          throw new Error('Failed to load run history');
        }
        const data = (await res.json()) as { runs: PlaybookRun[] };
        setRuns(prev => ({ ...prev, [playbookId]: data.runs || [] }));
      } catch (err) {
        console.error(err);
        setActionError(err instanceof Error ? err.message : 'Failed to load run history');
      } finally {
        setRunsLoading(prev => ({ ...prev, [playbookId]: false }));
      }
    },
    [token]
  );

  const handleToggleRuns = (playbookId: string) => {
    if (expandedPlaybookId === playbookId) {
      setExpandedPlaybookId(null);
      return;
    }
    setExpandedPlaybookId(playbookId);
    void loadRuns(playbookId);
  };

  const handleConfirmRun = async (playbookId: string, runId: string) => {
    try {
      setActionError(null);
      const res = await fetch(
        `${API_BASE}/api/automation/playbooks/${playbookId}/runs/${runId}/confirm`,
        {
          method: 'POST',
          headers: authenticatedHeaders,
        }
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || 'Failed to confirm run');
      }
      setActionMessage('Automation run approved');
      await fetchPlaybooks();
      await loadRuns(playbookId);
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : 'Unable to confirm run');
    }
  };

  const templateList = useMemo(() => templates, [templates]);

  return (
    <section className="bg-white rounded-lg shadow p-6 space-y-6">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Automation Playbooks</h3>
          <p className="text-sm text-gray-500">
            Templated workflows that watch your books and trigger actions automatically.
          </p>
        </div>
        {loading && <p className="text-xs text-gray-500">Refreshing…</p>}
      </header>

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

      <div className="space-y-4">
        {playbooks.length === 0 && !loading ? (
          <p className="text-sm text-gray-500">
            No playbooks configured yet. Choose a template below to get started.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {playbooks.map(playbook => (
              <div key={playbook.id} className="rounded-lg border border-gray-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-gray-900">{playbook.name}</h4>
                    <p className="text-sm text-gray-500">{playbook.description}</p>
                  </div>
                  <StatusPill status={playbook.status} />
                </div>

                <div className="mt-3 space-y-1 text-sm text-gray-600">
                  <p>
                    Last run:{' '}
                    {playbook.lastRunAt
                      ? new Date(playbook.lastRunAt).toLocaleString('en-GB')
                      : 'Never'}
                  </p>
                  <p>
                    Last result:{' '}
                    {playbook.lastRunStatus ? playbook.lastRunStatus.replace(/_/g, ' ') : '—'}
                  </p>
                  {playbook.pendingApprovals > 0 && (
                    <p className="text-amber-600">
                      {playbook.pendingApprovals} pending approval
                      {playbook.pendingApprovals > 1 ? 's' : ''}
                    </p>
                  )}
                </div>

                {playbook.lastRunSummary && Object.keys(playbook.lastRunSummary).length > 0 && (
                  <div className="mt-3 rounded bg-gray-50 p-3 text-xs text-gray-600">
                    {Object.entries(playbook.lastRunSummary)
                      .slice(0, 3)
                      .map(([key, value]) => (
                        <div key={key}>
                          <span className="font-medium">{formatSummaryKey(key)}:</span>{' '}
                          <span>{String(value)}</span>
                        </div>
                      ))}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => handleRunPlaybook(playbook)}
                    disabled={runningPlaybookId === playbook.id}
                    className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {runningPlaybookId === playbook.id ? 'Running…' : 'Run now'}
                  </button>
                  <button
                    onClick={() => handleToggleStatus(playbook)}
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {playbook.status === 'active' ? 'Pause' : 'Activate'}
                  </button>
                  <button
                    onClick={() => handleToggleRuns(playbook.id)}
                    className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    {expandedPlaybookId === playbook.id ? 'Hide history' : 'View history'}
                  </button>
                </div>

                {expandedPlaybookId === playbook.id && (
                  <div className="mt-4 space-y-2 rounded border border-gray-100 p-3">
                    {runsLoading[playbook.id] && (
                      <p className="text-xs text-gray-500">Fetching run history…</p>
                    )}
                    {!runsLoading[playbook.id] && (runs[playbook.id]?.length ?? 0) === 0 && (
                      <p className="text-sm text-gray-500">No runs recorded yet.</p>
                    )}
                    {(runs[playbook.id] || []).map(run => (
                      <div
                        key={run.id}
                        className="rounded bg-gray-50 p-3 text-sm text-gray-700 shadow-inner"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{run.status.replace(/_/g, ' ')}</span>
                          <span className="text-xs text-gray-500">
                            {new Date(run.createdAt).toLocaleString('en-GB')}
                          </span>
                        </div>
                        {run.message && (
                          <p className="mt-1 text-xs text-gray-500">{run.message}</p>
                        )}
                        {run.status === 'awaiting_approval' && (
                          <button
                            onClick={() => handleConfirmRun(playbook.id, run.id)}
                            className="mt-2 rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                          >
                            Approve actions
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
            Available templates
          </h4>
          <p className="text-sm text-gray-500">
            Pick a playbook, tweak the guardrails, and deploy it to your workspace.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {templateList.map(template => (
            <div key={template.key} className="rounded-lg border border-gray-100 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h5 className="font-semibold text-gray-900">{template.name}</h5>
                  <p className="text-sm text-gray-500">{template.description}</p>
                </div>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                  {template.category}
                </span>
              </div>
              <p className="mt-2 text-xs text-gray-500">{template.callToAction}</p>
              <button
                onClick={() => handleSelectTemplate(template)}
                className="mt-3 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Configure
              </button>
            </div>
          ))}
        </div>
      </div>

      {pendingTemplate && (
        <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-semibold text-gray-900">Configure {pendingTemplate.name}</h4>
              <p className="text-sm text-gray-600">
                Adjust the guardrails, then deploy. Defaults are shown below.
              </p>
            </div>
            <button
              onClick={() => setPendingTemplate(null)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {pendingTemplate.configFields.map(field => (
              <label key={field.key} className="text-sm text-gray-700">
                {field.label}
                <input
                  type="number"
                  value={templateConfig[field.key] ?? pendingTemplate.defaultConfig[field.key] ?? 0}
                  min={field.min}
                  max={field.max}
                  step={field.step || 1}
                  onChange={event =>
                    setTemplateConfig(prev => ({
                      ...prev,
                      [field.key]: Number(event.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1"
                />
                {field.helperText && (
                  <p className="text-xs text-gray-500">{field.helperText}</p>
                )}
              </label>
            ))}
          </div>
          <div className="mt-4 flex gap-3">
            <button
              onClick={handleCreatePlaybook}
              disabled={savingTemplate}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {savingTemplate ? 'Adding…' : 'Add playbook'}
            </button>
            <button
              onClick={() => setPendingTemplate(null)}
              className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: PlaybookStatus }) {
  const map: Record<PlaybookStatus, string> = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-yellow-100 text-yellow-700',
    draft: 'bg-gray-200 text-gray-600',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  );
}

function formatSummaryKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
