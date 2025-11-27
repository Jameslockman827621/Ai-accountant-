'use client';

import React, { useState } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('ReconciliationReport');

interface ReconciliationReport {
  periodStart: string;
  periodEnd: string;
  bankBalance: number;
  ledgerBalance: number;
  difference: number;
  matched: number;
  unmatched: number;
  items: Array<{
    bankTransactionId: string;
    ledgerEntryId: string | null;
    date: string;
    amount: number;
    description: string;
    status: 'matched' | 'unmatched';
  }>;
  summary: {
    totalBankTransactions: number;
    totalLedgerEntries: number;
    matchRate: number;
    discrepancies: number;
  };
}

export default function ReconciliationReport() {
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [accountId, setAccountId] = useState('');

  const generateReport = async () => {
    if (!periodStart || !periodEnd) {
      alert('Please select a period');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const params = new URLSearchParams({
        periodStart,
        periodEnd,
      });
      if (accountId) params.append('accountId', accountId);

      const response = await fetch(`/api/reconciliation/report?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to generate report');

      const data = await response.json();
      setReport(data.report);
    } catch (error) {
      logger.error('Failed to generate report', error);
      alert('Failed to generate reconciliation report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold mb-4">Reconciliation Report</h2>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Period Start
            </label>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Period End
            </label>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Account ID (Optional)
            </label>
            <input
              type="text"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="Leave empty for all accounts"
            />
          </div>
        </div>

        <button
          onClick={generateReport}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          Generate Report
        </button>

        {report && (
          <div className="mt-6 space-y-4">
            <div className="grid grid-cols-4 gap-4">
              <div className="p-4 bg-blue-50 rounded">
                <p className="text-sm text-gray-600">Bank Balance</p>
                <p className="text-xl font-bold">£{report.bankBalance.toLocaleString()}</p>
              </div>
              <div className="p-4 bg-green-50 rounded">
                <p className="text-sm text-gray-600">Ledger Balance</p>
                <p className="text-xl font-bold">£{report.ledgerBalance.toLocaleString()}</p>
              </div>
              <div className="p-4 bg-yellow-50 rounded">
                <p className="text-sm text-gray-600">Difference</p>
                <p className="text-xl font-bold">£{Math.abs(report.difference).toLocaleString()}</p>
              </div>
              <div className="p-4 bg-purple-50 rounded">
                <p className="text-sm text-gray-600">Match Rate</p>
                <p className="text-xl font-bold">{(report.summary.matchRate * 100).toFixed(1)}%</p>
              </div>
            </div>

            <div className="p-4 bg-gray-50 rounded">
              <p className="text-sm">
                <strong>Summary:</strong> {report.summary.totalBankTransactions} bank transactions,{' '}
                {report.summary.totalLedgerEntries} ledger entries, {report.matched} matched,{' '}
                {report.unmatched} unmatched
              </p>
            </div>

            <div className="max-h-96 overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Amount</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Description</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {report.items.map((item, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-sm">{new Date(item.date).toLocaleDateString()}</td>
                      <td className="px-4 py-2 text-sm">£{item.amount.toLocaleString()}</td>
                      <td className="px-4 py-2 text-sm">{item.description}</td>
                      <td className="px-4 py-2 text-sm">
                        <span className={`px-2 py-1 rounded text-xs ${
                          item.status === 'matched' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
