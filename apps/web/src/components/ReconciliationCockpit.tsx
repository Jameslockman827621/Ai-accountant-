'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  DocumentTextIcon,
  BanknotesIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

interface MatchCandidate {
  documentId?: string;
  ledgerEntryId?: string;
  bankTransactionId: string;
  confidenceScore: number;
  signals: {
    amount: number;
    date: number;
    vendor: number;
    ocrConfidence: number;
    description: number;
  };
  reason: string;
  matchType: 'auto' | 'suggest' | 'manual';
}

interface BankTransaction {
  id: string;
  date: string;
  amount: number;
  currency: string;
  description: string;
  category: string | null;
  reconciled: boolean;
  suggestedMatch?: MatchCandidate;
}

interface ReconciliationEvent {
  id: string;
  eventType: string;
  reasonCode: string;
  reasonDescription?: string;
  confidenceScore?: number;
  performedAt: string;
  performedBy?: string;
}

interface ReconciliationCockpitProps {
  token: string;
  accountId?: string;
  startDate?: Date;
  endDate?: Date;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export default function ReconciliationCockpit({
  token,
  accountId,
  startDate,
  endDate,
}: ReconciliationCockpitProps) {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [events, setEvents] = useState<ReconciliationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'auto_matched' | 'in_review' | 'exceptions'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, [accountId, startDate, endDate]);

  async function fetchData() {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (accountId) params.append('accountId', accountId);
      if (startDate) params.append('startDate', startDate.toISOString());
      if (endDate) params.append('endDate', endDate.toISOString());

      const [txRes, eventsRes] = await Promise.all([
        fetch(`${API_BASE}/api/reconciliation/transactions?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE}/api/reconciliation/events?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!txRes.ok) throw new Error(`Transactions request failed (${txRes.status})`);
      if (!eventsRes.ok) throw new Error(`Events request failed (${eventsRes.status})`);

      const txData = await txRes.json() as { transactions: BankTransaction[] };
      const eventsData = await eventsRes.json() as { events: ReconciliationEvent[] };

      setTransactions(txData.transactions || []);
      setEvents(eventsData.events || []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load reconciliation data');
    } finally {
      setLoading(false);
    }
  }

  const filteredTransactions = useMemo(() => {
    let filtered = transactions;

    // Apply filter
    if (filter === 'auto_matched') {
      filtered = filtered.filter((tx) => tx.reconciled);
    } else if (filter === 'in_review') {
      filtered = filtered.filter((tx) => !tx.reconciled && tx.suggestedMatch);
    } else if (filter === 'exceptions') {
      filtered = filtered.filter((tx) => !tx.reconciled && !tx.suggestedMatch);
    }

    // Apply search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (tx) =>
          tx.description.toLowerCase().includes(term) ||
          tx.category?.toLowerCase().includes(term) ||
          tx.amount.toString().includes(term)
      );
    }

    return filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, filter, searchTerm]);

  const stats = useMemo(() => {
    const total = transactions.length;
    const reconciled = transactions.filter((tx) => tx.reconciled).length;
    const suggested = transactions.filter((tx) => !tx.reconciled && tx.suggestedMatch).length;
    const exceptions = transactions.filter((tx) => !tx.reconciled && !tx.suggestedMatch).length;

    return {
      total,
      reconciled,
      suggested,
      exceptions,
      autoMatchRate: total > 0 ? (reconciled / total) * 100 : 0,
    };
  }, [transactions]);

  async function acceptMatch(transactionId: string, match: MatchCandidate) {
    try {
      const res = await fetch(`${API_BASE}/api/reconciliation/match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          bankTransactionId: transactionId,
          documentId: match.documentId,
          ledgerEntryId: match.ledgerEntryId,
          matchType: 'manual',
        }),
      });

      if (!res.ok) throw new Error('Failed to accept match');

      await fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to accept match');
    }
  }

  async function rejectMatch(transactionId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/reconciliation/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bankTransactionId: transactionId }),
      });

      if (!res.ok) throw new Error('Failed to reject match');

      await fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to reject match');
    }
  }

  async function splitTransaction(transactionId: string) {
    // TODO: Implement split transaction UI
    alert('Split transaction feature coming soon');
  }

  if (loading && transactions.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-4 bg-gray-200 rounded"></div>
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Total Transactions</div>
          <div className="text-2xl font-bold mt-1">{stats.total}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Auto-Matched</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{stats.reconciled}</div>
          <div className="text-xs text-gray-400 mt-1">{stats.autoMatchRate.toFixed(1)}%</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">In Review</div>
          <div className="text-2xl font-bold text-yellow-600 mt-1">{stats.suggested}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Exceptions</div>
          <div className="text-2xl font-bold text-red-600 mt-1">{stats.exceptions}</div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search transactions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="flex gap-2">
            {(['all', 'auto_matched', 'in_review', 'exceptions'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  filter === f
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {f.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
              </button>
            ))}
          </div>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
          >
            <ArrowPathIcon className="h-5 w-5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Timeline View */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Reconciliation Timeline</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {filteredTransactions.map((tx) => (
            <div
              key={tx.id}
              className={`p-4 hover:bg-gray-50 transition-colors cursor-pointer ${
                selectedTransaction === tx.id ? 'bg-blue-50' : ''
              }`}
              onClick={() => setSelectedTransaction(selectedTransaction === tx.id ? null : tx.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    {tx.reconciled ? (
                      <CheckCircleIcon className="h-6 w-6 text-green-600" />
                    ) : tx.suggestedMatch ? (
                      <ClockIcon className="h-6 w-6 text-yellow-600" />
                    ) : (
                      <ExclamationTriangleIcon className="h-6 w-6 text-red-600" />
                    )}
                    <div className="flex-1">
                      <div className="font-medium">{tx.description}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        {new Date(tx.date).toLocaleDateString()} • {tx.category || 'Uncategorized'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">
                        {tx.amount >= 0 ? '+' : ''}
                        {tx.amount.toLocaleString('en-GB', {
                          style: 'currency',
                          currency: tx.currency,
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Match Details */}
                  {selectedTransaction === tx.id && (
                    <div className="mt-4 ml-9 p-4 bg-gray-50 rounded-lg space-y-4">
                      {tx.suggestedMatch && (
                        <div className="border-l-4 border-yellow-500 pl-4">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-medium text-yellow-800">Suggested Match</div>
                            <div className="text-sm text-gray-600">
                              Confidence: {(tx.suggestedMatch.confidenceScore * 100).toFixed(1)}%
                            </div>
                          </div>
                          <div className="text-sm text-gray-700 mb-2">{tx.suggestedMatch.reason}</div>
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                            <div>
                              <div className="text-gray-500">Amount</div>
                              <div className="font-medium">
                                {(tx.suggestedMatch.signals.amount * 100).toFixed(0)}%
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Date</div>
                              <div className="font-medium">
                                {(tx.suggestedMatch.signals.date * 100).toFixed(0)}%
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Vendor</div>
                              <div className="font-medium">
                                {(tx.suggestedMatch.signals.vendor * 100).toFixed(0)}%
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">OCR</div>
                              <div className="font-medium">
                                {(tx.suggestedMatch.signals.ocrConfidence * 100).toFixed(0)}%
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Description</div>
                              <div className="font-medium">
                                {(tx.suggestedMatch.signals.description * 100).toFixed(0)}%
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                acceptMatch(tx.id, tx.suggestedMatch!);
                              }}
                              className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 transition-colors"
                            >
                              Accept Match
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                rejectMatch(tx.id);
                              }}
                              className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors"
                            >
                              Reject
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                splitTransaction(tx.id);
                              }}
                              className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 transition-colors"
                            >
                              Split
                            </button>
                          </div>
                        </div>
                      )}

                      {!tx.reconciled && !tx.suggestedMatch && (
                        <div className="border-l-4 border-red-500 pl-4">
                          <div className="font-medium text-red-800 mb-2">No Match Found</div>
                          <div className="text-sm text-gray-700 mb-3">
                            This transaction requires manual review or document upload.
                          </div>
                          <div className="flex gap-2">
                            <button className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors">
                              Attach Document
                            </button>
                            <button className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700 transition-colors">
                              Add Note
                            </button>
                          </div>
                        </div>
                      )}

                      {tx.reconciled && (
                        <div className="border-l-4 border-green-500 pl-4">
                          <div className="font-medium text-green-800 mb-2">Reconciled</div>
                          <div className="text-sm text-gray-700">
                            This transaction was automatically matched and reconciled.
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {filteredTransactions.length === 0 && (
          <div className="p-8 text-center text-gray-500">
            {searchTerm ? 'No transactions match your search' : 'No transactions found'}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          {error}
        </div>
      )}
    </div>
  );
}
