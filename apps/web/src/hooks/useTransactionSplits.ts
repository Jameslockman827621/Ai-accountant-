'use client';

import { useCallback, useEffect, useState } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export type TransactionSplitStatus = 'draft' | 'pending_review' | 'applied' | 'void';

export interface SplitRow {
  id?: string;
  amount: number;
  currency: string;
  documentId?: string | null;
  ledgerEntryId?: string | null;
  memo?: string | null;
  tags?: string[];
  confidenceScore?: number | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  reviewNotes?: string | null;
}

export interface SplitSummary {
  transactionId: string;
  amount: number;
  currency: string;
  status: string;
  isSplit: boolean;
  splitRemainingAmount: number | null;
  submittedBy?: string | null;
  submittedAt?: string | null;
  reviewNotes?: string | null;
  splits: SplitRow[];
}

export interface UseTransactionSplitsResult {
  summary: SplitSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveDrafts: (splits: Array<Omit<SplitRow, 'id'>>) => Promise<void>;
  clearSplits: () => Promise<void>;
  submitSplits: () => Promise<void>;
  approveSplits: (options?: { notes?: string | null }) => Promise<void>;
  rejectSplits: (reason?: string) => Promise<void>;
}

function buildHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export function useTransactionSplits(token: string, transactionId: string | null): UseTransactionSplitsResult {
  const [summary, setSummary] = useState<SplitSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!transactionId) {
      setSummary(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE}/api/reconciliation/transactions/${transactionId}/splits`,
        {
          headers: buildHeaders(token),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || `Failed to load splits (status ${response.status})`);
      }
      const data = (await response.json()) as SplitSummary;
      setSummary({
        ...data,
        splits: data.splits?.map((split) => ({
          ...split,
          tags: Array.isArray(split.tags) ? split.tags : [],
        })) ?? [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load splits');
    } finally {
      setLoading(false);
    }
  }, [token, transactionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveDrafts(splits: Array<Omit<SplitRow, 'id'>>): Promise<void> {
    if (!transactionId) {
      throw new Error('Missing transaction ID');
    }
    const payload = splits.map((split) => ({
      amount: split.amount,
      currency: split.currency,
      documentId: split.documentId ?? null,
      ledgerEntryId: split.ledgerEntryId ?? null,
      memo: split.memo ?? null,
      tags: split.tags ?? [],
      confidenceScore: split.confidenceScore ?? null,
    }));
    const res = await fetch(
      `${API_BASE}/api/reconciliation/transactions/${transactionId}/splits`,
      {
        method: 'PUT',
        headers: buildHeaders(token),
        body: JSON.stringify({ splits: payload }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Failed to save splits');
    }
    await refresh();
  }

  async function clearSplits(): Promise<void> {
    if (!transactionId) return;
    const res = await fetch(
      `${API_BASE}/api/reconciliation/transactions/${transactionId}/splits`,
      {
        method: 'DELETE',
        headers: buildHeaders(token),
      }
    );
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Failed to delete splits');
    }
    await refresh();
  }

  async function submitSplits(): Promise<void> {
    if (!transactionId) return;
    const res = await fetch(
      `${API_BASE}/api/reconciliation/transactions/${transactionId}/splits/submit`,
      {
        method: 'POST',
        headers: buildHeaders(token),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Failed to submit splits');
    }
    await refresh();
  }

  async function approveSplits(options?: { notes?: string | null }): Promise<void> {
    if (!transactionId) return;
    const res = await fetch(
      `${API_BASE}/api/reconciliation/transactions/${transactionId}/splits/approve`,
      {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({ notes: options?.notes ?? null }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Failed to approve splits');
    }
    await refresh();
  }

  async function rejectSplits(reason?: string): Promise<void> {
    if (!transactionId) return;
    const res = await fetch(
      `${API_BASE}/api/reconciliation/transactions/${transactionId}/splits/reject`,
      {
        method: 'POST',
        headers: buildHeaders(token),
        body: JSON.stringify({ reason: reason ?? null }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Failed to reject splits');
    }
    await refresh();
  }

  return {
    summary,
    loading,
    error,
    refresh,
    saveDrafts,
    clearSplits,
    submitSplits,
    approveSplits,
    rejectSplits,
  };
}
