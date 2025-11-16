'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ReconciliationMatching');

interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  accountId: string;
  accountName: string;
  status: 'unmatched' | 'matched' | 'partial';
}

interface MatchCandidate {
  documentId?: string;
  ledgerEntryId?: string;
  type: 'document' | 'ledger';
  description: string;
  amount: number;
  date: string;
  matchScore: number;
  matchType: 'exact' | 'partial' | 'fuzzy';
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface ReconciliationMatchingProps {
  token: string;
  tenantId: string;
}

export default function ReconciliationMatching({ token, tenantId }: ReconciliationMatchingProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [matches, setMatches] = useState<MatchCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unmatched' | 'matched' | 'partial'>('unmatched');

  useEffect(() => {
    loadTransactions();
    const interval = setInterval(loadTransactions, 30000);
    return () => clearInterval(interval);
  }, [filter]);

  useEffect(() => {
    if (selectedTransaction) {
      loadMatches(selectedTransaction.id);
    }
  }, [selectedTransaction]);

  const loadTransactions = async () => {
    try {
      const status = filter === 'all' ? undefined : filter;
      const params = status ? `?status=${status}` : '';

      const response = await fetch(`${API_BASE}/api/bank-feed/transactions${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load transactions');

      const data = await response.json();
      setTransactions(data.transactions || []);
    } catch (error) {
      logger.error('Failed to load transactions', error);
    } finally {
      setLoading(false);
    }
  };

  const loadMatches = async (transactionId: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/reconciliation/matches/${transactionId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to load matches');

      const data = await response.json();
      setMatches(data.matches || []);
    } catch (error) {
      logger.error('Failed to load matches', error);
    }
  };

  const reconcileTransaction = async (transactionId: string, documentId?: string, ledgerEntryId?: string) => {
    try {
      const response = await fetch(`${API_BASE}/api/reconciliation/reconcile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transactionId,
          documentId,
          ledgerEntryId,
        }),
      });

      if (!response.ok) throw new Error('Reconciliation failed');

      await loadTransactions();
      if (selectedTransaction?.id === transactionId) {
        setSelectedTransaction(null);
        setMatches([]);
      }
    } catch (error) {
      logger.error('Failed to reconcile transaction', error);
      alert('Failed to reconcile transaction');
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  const filteredTransactions = transactions.filter(t =>
    filter === 'all' || t.status === filter
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reconciliation Matching</h1>
          <p className="text-gray-600 mt-1">Match bank transactions to documents and ledger entries</p>
        </div>
        <div className="flex items-center space-x-2">
          {(['all', 'unmatched', 'matched', 'partial'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                filter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Transaction List */}
        <div className="lg:col-span-2 space-y-4">
          {filteredTransactions.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
              <p className="text-gray-500">No transactions found</p>
            </div>
          ) : (
            filteredTransactions.map(transaction => (
              <div
                key={transaction.id}
                onClick={() => setSelectedTransaction(transaction)}
                className={`rounded-lg border p-4 cursor-pointer transition-all ${
                  selectedTransaction?.id === transaction.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 bg-white hover:border-gray-300'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2 mb-2">
                      <StatusBadge status={transaction.status} />
                      <span className="text-xs text-gray-500">{transaction.accountName}</span>
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1">{transaction.description}</h3>
                    <div className="flex items-center space-x-4 text-sm text-gray-600">
                      <span>{new Date(transaction.date).toLocaleDateString()}</span>
                      <span className="font-medium text-gray-900">
                        {transaction.currency} {transaction.amount.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Match Panel */}
        <div className="lg:col-span-1">
          {selectedTransaction ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 sticky top-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Match Candidates</h2>

              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-900">{selectedTransaction.description}</p>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedTransaction.currency} {selectedTransaction.amount.toLocaleString()}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(selectedTransaction.date).toLocaleDateString()}
                </p>
              </div>

              {matches.length === 0 ? (
                <div className="text-center text-gray-500 py-8">
                  <p className="text-sm">No matches found</p>
                  <p className="text-xs mt-1">This transaction may need manual review</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {matches.map((match, idx) => (
                    <div
                      key={idx}
                      className="border border-gray-200 rounded-lg p-3"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <TypeBadge type={match.type} />
                        <MatchScoreBadge score={match.matchScore} matchType={match.matchType} />
                      </div>
                      <p className="text-sm font-medium text-gray-900 mb-1">{match.description}</p>
                      <div className="flex items-center justify-between text-xs text-gray-600 mb-2">
                        <span>{new Date(match.date).toLocaleDateString()}</span>
                        <span className="font-medium">{match.amount.toLocaleString()}</span>
                      </div>
                      <button
                        onClick={() => reconcileTransaction(
                          selectedTransaction.id,
                          match.documentId,
                          match.ledgerEntryId
                        )}
                        className="w-full px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        Match
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => {
                  setSelectedTransaction(null);
                  setMatches([]);
                }}
                className="mt-4 w-full px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Clear Selection
              </button>
            </div>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-gray-500">
              Select a transaction to view match candidates
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Transaction['status'] }) {
  const colors = {
    unmatched: 'bg-red-100 text-red-800',
    matched: 'bg-green-100 text-green-800',
    partial: 'bg-yellow-100 text-yellow-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[status]}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function TypeBadge({ type }: { type: 'document' | 'ledger' }) {
  const colors = {
    document: 'bg-blue-100 text-blue-800',
    ledger: 'bg-purple-100 text-purple-800',
  };

  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors[type]}`}>
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  );
}

function MatchScoreBadge({ score, matchType }: { score: number; matchType: MatchCandidate['matchType'] }) {
  const color = score >= 0.9 ? 'text-green-600' : score >= 0.7 ? 'text-yellow-600' : 'text-red-600';

  return (
    <span className={`text-xs font-medium ${color}`}>
      {(score * 100).toFixed(0)}% {matchType}
    </span>
  );
}
