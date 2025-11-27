import { useEffect, useMemo, useState } from 'react';

type ReviewQueueItem = {
  id: string;
  documentId: string;
  priorityScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'assigned' | 'in_review' | 'approved' | 'rejected' | 'escalated';
  slaDeadline?: string;
  createdAt: string;
};

type ActionType = 'approve' | 'reject' | 'escalate' | 'retry' | 'resolve';

const riskColors: Record<ReviewQueueItem['riskLevel'], string> = {
  low: 'bg-green-100 text-green-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

const statusColors: Record<ReviewQueueItem['status'], string> = {
  pending: 'text-slate-700',
  assigned: 'text-blue-700',
  in_review: 'text-purple-700',
  approved: 'text-green-700',
  rejected: 'text-red-700',
  escalated: 'text-orange-700',
};

export default function ReviewQueuePage() {
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | ReviewQueueItem['status']>('all');

  const filteredQueue = useMemo(() => {
    if (filter === 'all') return queue;
    return queue.filter((item) => item.status === filter);
  }, [filter, queue]);

  useEffect(() => {
    loadQueue();
  }, []);

  async function loadQueue() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/quality/review-queue');
      const payload = await response.json();
      setQueue(payload.queue || []);
    } catch (err) {
      setError('Unable to load review queue');
    } finally {
      setLoading(false);
    }
  }

  function toggleSelection(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function applyAction(action: ActionType) {
    if (selected.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      await fetch('/api/quality/review-queue/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewQueueIds: Array.from(selected), action }),
      });
      clearSelection();
      await loadQueue();
    } catch (err) {
      setError('Unable to apply action');
    } finally {
      setLoading(false);
    }
  }

  function renderSla(item: ReviewQueueItem) {
    if (!item.slaDeadline) return <span className="text-xs text-slate-500">No SLA</span>;
    const deadline = new Date(item.slaDeadline);
    const now = new Date();
    const diffMs = deadline.getTime() - now.getTime();
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    const breached = diffMs < 0;

    return (
      <span className={`text-xs font-semibold ${breached ? 'text-red-700' : 'text-slate-700'}`}>
        {breached ? 'SLA breached' : `${diffHours}h remaining`}
      </span>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mx-auto max-w-6xl rounded-lg bg-white p-6 shadow">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Review queue</h1>
            <p className="text-sm text-slate-600">
              Bulk actions, SLA visibility, and anomaly-driven review tasks.
            </p>
          </div>
          <div className="flex gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-700"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="assigned">Assigned</option>
              <option value="in_review">In review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="escalated">Escalated</option>
            </select>
            <button
              onClick={loadQueue}
              className="rounded bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          {(['approve', 'reject', 'escalate', 'retry', 'resolve'] as ActionType[]).map((action) => (
            <button
              key={action}
              disabled={selected.size === 0 || loading}
              onClick={() => applyAction(action)}
              className="rounded border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {action === 'retry' ? 'Retry workflow' : action.charAt(0).toUpperCase() + action.slice(1)}
            </button>
          ))}
        </div>

        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200">
          <div className="grid grid-cols-7 bg-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <div>
              <input
                type="checkbox"
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelected(new Set(filteredQueue.map((item) => item.id)));
                  } else {
                    clearSelection();
                  }
                }}
                className="h-4 w-4"
              />
            </div>
            <div>Document</div>
            <div>Priority</div>
            <div>Risk</div>
            <div>Status</div>
            <div>SLA</div>
            <div>Created</div>
          </div>
          {loading && <div className="p-4 text-sm text-slate-600">Loading queue…</div>}
          {!loading && filteredQueue.length === 0 && (
            <div className="p-4 text-sm text-slate-600">No review items found.</div>
          )}
          {!loading && filteredQueue.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-7 items-center border-t border-slate-100 px-4 py-3 text-sm"
            >
              <div>
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelection(item.id)}
                  className="h-4 w-4"
                />
              </div>
              <div className="truncate text-slate-800">{item.documentId}</div>
              <div className="font-semibold text-slate-800">{item.priorityScore}</div>
              <div>
                <span className={`rounded px-2 py-1 text-xs font-semibold ${riskColors[item.riskLevel]}`}>
                  {item.riskLevel}
                </span>
              </div>
              <div className={`font-medium ${statusColors[item.status]}`}>{item.status.replace('_', ' ')}</div>
              <div>{renderSla(item)}</div>
              <div className="text-xs text-slate-600">{new Date(item.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
