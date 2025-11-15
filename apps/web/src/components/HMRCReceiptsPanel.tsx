'use client';

import React, { useEffect, useState } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface FilingReceipt {
  id: string;
  filingId: string;
  submissionId: string;
  filingType: string;
  filingStatus: string;
  receivedAt: string;
  hmrcReference?: string;
}

interface ReceiptsResponse {
  receipts: Array<
    FilingReceipt & {
      payload?: Record<string, unknown>;
    }
  >;
}

interface HMRCReceiptsPanelProps {
  token: string;
}

export default function HMRCReceiptsPanel({ token }: HMRCReceiptsPanelProps) {
  const [receipts, setReceipts] = useState<FilingReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchReceipts() {
      try {
        setLoading(true);
        const response = await fetch(`${API_BASE}/api/filings/receipts?limit=5`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Receipts request failed: ${response.status}`);
        }

        const data = (await response.json()) as ReceiptsResponse;
        setReceipts(
          data.receipts.map((receipt) => ({
            id: receipt.id,
            filingId: receipt.filingId,
            submissionId: receipt.submissionId,
            filingType: receipt.filingType,
            filingStatus: receipt.filingStatus,
            receivedAt: receipt.receivedAt,
            hmrcReference: receipt.hmrcReference,
          }))
        );
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        console.error('Failed to fetch HMRC receipts', err);
        setError('Unable to load HMRC receipts.');
      } finally {
        setLoading(false);
      }
    }

    fetchReceipts();

    return () => controller.abort();
  }, [token]);

  return (
    <section className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">Recent HMRC Receipts</h2>
          <p className="text-sm text-gray-500">Latest VAT submissions acknowledged by HMRC</p>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading receipts…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : receipts.length === 0 ? (
        <p className="text-gray-500">No HMRC receipts received yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-2 pr-4">Received</th>
                <th className="py-2 pr-4">Filing</th>
                <th className="py-2 pr-4">Submission ID</th>
                <th className="py-2 pr-4">Reference</th>
                <th className="py-2 pr-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {receipts.map((receipt) => (
                <tr key={receipt.id}>
                  <td className="py-3 pr-4">
                    {new Date(receipt.receivedAt).toLocaleString('en-GB')}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="font-medium">{receipt.filingType}</div>
                    <div className="text-xs text-gray-500">{receipt.filingId}</div>
                  </td>
                  <td className="py-3 pr-4">{receipt.submissionId}</td>
                  <td className="py-3 pr-4">
                    {receipt.hmrcReference || '—'}
                  </td>
                  <td className="py-3 pr-4 text-right">
                    <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-700 uppercase tracking-wide">
                      {receipt.filingStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
