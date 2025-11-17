'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { SplitRow, useTransactionSplits } from '@/hooks/useTransactionSplits';

interface SplitTransactionDrawerProps {
  token: string;
  transactionId: string | null;
  transaction: {
    id: string;
    description: string;
    date: string;
    amount: number;
    currency: string;
    isSplit?: boolean;
    splitStatus?: string;
  } | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

interface DraftRow {
  id?: string;
  amount: number;
  currency: string;
  documentId?: string | null;
  ledgerEntryId?: string | null;
  memo?: string | null;
  tags: string[];
}

function emptyDraft(currency: string): DraftRow {
  return {
    amount: 0,
    currency,
    documentId: null,
    ledgerEntryId: null,
    memo: '',
    tags: [],
  };
}

export function SplitTransactionDrawer({
  token,
  transactionId,
  transaction,
  open,
  onClose,
  onChanged,
}: SplitTransactionDrawerProps) {
  const {
    summary,
    loading,
    error,
    refresh,
    saveDrafts,
    clearSplits,
    submitSplits,
    approveSplits,
    rejectSplits,
  } = useTransactionSplits(token, transactionId);

  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!summary || !transaction) {
      return;
    }
    if (summary.splits.length === 0) {
      setDrafts([emptyDraft(summary.currency)]);
    } else {
      setDrafts(
        summary.splits.map((split) => ({
          id: split.id,
          amount: split.amount,
          currency: split.currency,
          documentId: split.documentId ?? null,
          ledgerEntryId: split.ledgerEntryId ?? null,
          memo: split.memo ?? '',
          tags: split.tags ?? [],
        }))
      );
    }
  }, [summary, transaction]);

  const totals = useMemo(() => {
    const allocated = drafts.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    const transactionAmount = transaction?.amount ?? summary?.amount ?? 0;
    const remaining = transactionAmount - allocated;
    return { allocated, transactionAmount, remaining };
  }, [drafts, transaction, summary]);

  function updateDraft(index: number, patch: Partial<DraftRow>) {
    setDrafts((rows) =>
      rows.map((row, idx) => (idx === index ? { ...row, ...patch } : row))
    );
  }

  function addRow() {
    const currency = summary?.currency || transaction?.currency || 'GBP';
    setDrafts((rows) => [...rows, emptyDraft(currency)]);
  }

  function removeRow(index: number) {
    setDrafts((rows) => rows.filter((_, idx) => idx !== index));
  }

  async function handleSaveDrafts() {
    if (!transactionId || !summary) return;
    setBusy(true);
    setMessage(null);
    try {
      const prepared = drafts.map((draft) => ({
        amount: Number(draft.amount),
        currency: draft.currency,
        documentId: draft.documentId || null,
        ledgerEntryId: draft.ledgerEntryId || null,
        memo: draft.memo ?? null,
        tags: draft.tags,
      }));
      await saveDrafts(prepared);
      setMessage('Splits saved');
      onChanged?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save splits');
    } finally {
      setBusy(false);
    }
  }

  async function handleClearSplits() {
    if (!transactionId) return;
    if (!window.confirm('Remove all splits for this transaction?')) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await clearSplits();
      setDrafts([emptyDraft(transaction?.currency || summary?.currency || 'GBP')]);
      setMessage('Splits cleared');
      onChanged?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to clear splits');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    setBusy(true);
    setMessage(null);
    try {
      await submitSplits();
      setMessage('Splits submitted for review');
      onChanged?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to submit splits');
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    setBusy(true);
    setMessage(null);
    try {
      await approveSplits();
      setMessage('Splits approved and applied');
      onChanged?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to approve splits');
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    const reason = window.prompt('Provide reason for rejection (optional)');
    setBusy(true);
    setMessage(null);
    try {
      await rejectSplits(reason || undefined);
      setMessage('Splits returned to draft');
      onChanged?.();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to reject splits');
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || loading;
  const submissionAllowed = summary?.splits?.length && totals.remaining === 0;

  return (
    <Transition.Root show={open} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={disabled ? () => {} : onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
              <Transition.Child
                as={Fragment}
                enter="transform transition ease-in-out duration-300"
                enterFrom="translate-x-full"
                enterTo="translate-x-0"
                leave="transform transition ease-in-out duration-300"
                leaveFrom="translate-x-0"
                leaveTo="translate-x-full"
              >
                <Dialog.Panel className="pointer-events-auto w-screen max-w-3xl">
                  <div className="flex h-full flex-col overflow-y-scroll bg-white shadow-xl">
                    <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                      <div>
                        <Dialog.Title className="text-lg font-semibold">Split Transaction</Dialog.Title>
                        {transaction && (
                          <p className="text-sm text-gray-500">
                            {transaction.description} · {new Date(transaction.date).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700"
                        disabled={disabled}
                      >
                        Close
                      </button>
                    </div>

                    <div className="p-6 space-y-6">
                      {loading && (
                        <div className="rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-700">
                          Loading splits…
                        </div>
                      )}
                      {error && (
                        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
                      )}
                      {message && (
                        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-700">{message}</div>
                      )}

                      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <StatCard label="Transaction Total" value={totals.transactionAmount} currency={transaction?.currency || summary?.currency} />
                        <StatCard label="Allocated" value={totals.allocated} currency={transaction?.currency || summary?.currency} />
                        <StatCard
                          label="Remaining"
                          value={totals.remaining}
                          currency={transaction?.currency || summary?.currency}
                          highlight={Math.abs(totals.remaining) > 0.005}
                        />
                      </section>

                      <section>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-md font-semibold">Split Lines</h3>
                          <button
                            onClick={addRow}
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
                            disabled={disabled}
                          >
                            <PlusIcon className="h-4 w-4" />
                            Add line
                          </button>
                        </div>
                        <div className="space-y-4">
                          {drafts.map((draft, index) => (
                            <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3">
                              <div className="flex flex-col md:flex-row gap-3">
                                <div className="md:w-1/5">
                                  <label className="text-xs text-gray-500">Amount</label>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={draft.amount}
                                    onChange={(e) => updateDraft(index, { amount: Number(e.target.value) })}
                                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                    disabled={disabled}
                                  />
                                </div>
                                <div className="md:w-2/5">
                                  <label className="text-xs text-gray-500">Document ID</label>
                                  <input
                                    type="text"
                                    value={draft.documentId ?? ''}
                                    placeholder="Optional"
                                    onChange={(e) => updateDraft(index, { documentId: e.target.value || null })}
                                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                    disabled={disabled}
                                  />
                                </div>
                                <div className="md:w-2/5">
                                  <label className="text-xs text-gray-500">Ledger Entry ID</label>
                                  <input
                                    type="text"
                                    value={draft.ledgerEntryId ?? ''}
                                    placeholder="Optional"
                                    onChange={(e) => updateDraft(index, { ledgerEntryId: e.target.value || null })}
                                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                    disabled={disabled}
                                  />
                                </div>
                                <div className="md:w-auto flex items-center justify-end">
                                  <button
                                    onClick={() => removeRow(index)}
                                    className="text-red-600 hover:text-red-800"
                                    disabled={disabled || drafts.length === 1}
                                    title="Remove line"
                                  >
                                    <TrashIcon className="h-5 w-5" />
                                  </button>
                                </div>
                              </div>
                              <div className="flex flex-col md:flex-row gap-3">
                                <div className="md:w-2/3">
                                  <label className="text-xs text-gray-500">Memo</label>
                                  <input
                                    type="text"
                                    value={draft.memo ?? ''}
                                    onChange={(e) => updateDraft(index, { memo: e.target.value })}
                                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                    disabled={disabled}
                                  />
                                </div>
                                <div className="md:w-1/3">
                                  <label className="text-xs text-gray-500">Tags (comma separated)</label>
                                  <input
                                    type="text"
                                    value={draft.tags.join(', ')}
                                    onChange={(e) =>
                                      updateDraft(index, {
                                        tags: e.target.value
                                          .split(',')
                                          .map((tag) => tag.trim())
                                          .filter(Boolean),
                                      })
                                    }
                                    className="mt-1 w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                                    disabled={disabled}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>

                      <section className="flex flex-wrap gap-3">
                        <button
                          onClick={handleSaveDrafts}
                          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                          disabled={disabled}
                        >
                          Save Draft
                        </button>
                        <button
                          onClick={handleClearSplits}
                          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 disabled:opacity-50"
                          disabled={disabled}
                        >
                          Clear Splits
                        </button>
                        {summary?.status !== 'pending_review' && (
                          <button
                            onClick={handleSubmit}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                            disabled={disabled || !submissionAllowed}
                            title={!submissionAllowed ? 'Allocate the full amount before submitting' : ''}
                          >
                            Submit for Review
                          </button>
                        )}
                        {summary?.status === 'pending_review' && (
                          <>
                            <button
                              onClick={handleApprove}
                              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                              disabled={disabled}
                            >
                              Approve & Apply
                            </button>
                            <button
                              onClick={handleReject}
                              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                              disabled={disabled}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </section>
                    </div>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  );
}

function StatCard({
  label,
  value,
  currency,
  highlight,
}: {
  label: string;
  value: number;
  currency?: string;
  highlight?: boolean;
}) {
  const formatted =
    currency && Number.isFinite(value)
      ? value.toLocaleString('en-GB', { style: 'currency', currency })
      : value.toFixed(2);
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold">{formatted}</div>
    </div>
  );
}
