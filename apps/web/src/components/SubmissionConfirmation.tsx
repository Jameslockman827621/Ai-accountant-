'use client';

import React, { useState, useEffect } from 'react';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('SubmissionConfirmation');

interface SubmissionConfirmationProps {
  filingId: string;
}

export default function SubmissionConfirmation({ filingId }: SubmissionConfirmationProps) {
  const [confirmation, setConfirmation] = useState<{
    filingId: string;
    submissionId: string;
    submittedAt: string;
    confirmationNumber?: string;
    receipt?: { url: string; storageKey: string; contentType: string };
    status: 'submitted' | 'accepted' | 'rejected';
    responseData?: Record<string, unknown>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadConfirmation();
  }, [filingId]);

  const loadConfirmation = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`/api/filings/${filingId}/confirmation`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          setConfirmation(null);
          return;
        }
        throw new Error('Failed to load confirmation');
      }

      const data = await response.json();
      setConfirmation(data.confirmation);
    } catch (error) {
      logger.error('Failed to load confirmation', error);
    } finally {
      setLoading(false);
    }
  };

  const downloadReceipt = async () => {
    if (!confirmation?.receipt?.url) return;

    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(confirmation.receipt.url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) throw new Error('Failed to download receipt');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${confirmation.submissionId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      logger.error('Failed to download receipt', error);
      alert('Failed to download receipt');
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading confirmation...</div>;
  }

  if (!confirmation) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-center py-8">
          <p className="text-gray-500">No submission confirmation available</p>
          <p className="text-sm text-gray-400 mt-2">This filing has not been submitted yet.</p>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'accepted':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'rejected':
        return 'bg-red-50 border-red-200 text-red-800';
      default:
        return 'bg-yellow-50 border-yellow-200 text-yellow-800';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Submission Confirmation</h2>
        <span className={`px-3 py-1 rounded text-sm font-medium ${getStatusColor(confirmation.status)}`}>
          {confirmation.status.toUpperCase()}
        </span>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600">Submission ID</p>
            <p className="font-mono text-sm">{confirmation.submissionId}</p>
          </div>
          {confirmation.confirmationNumber && (
            <div>
              <p className="text-sm text-gray-600">Confirmation Number</p>
              <p className="font-mono text-sm">{confirmation.confirmationNumber}</p>
            </div>
          )}
        </div>

        <div>
          <p className="text-sm text-gray-600">Submitted At</p>
          <p className="font-semibold">
            {new Date(confirmation.submittedAt).toLocaleString()}
          </p>
        </div>

        {confirmation.receipt && (
          <div className="p-4 bg-blue-50 border border-blue-200 rounded">
            <p className="font-semibold mb-2">Receipt Available</p>
            <button
              onClick={downloadReceipt}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Download Receipt
            </button>
          </div>
        )}

        {confirmation.responseData && (
          <div className="p-4 bg-gray-50 rounded">
            <p className="font-semibold mb-2">Response Data</p>
            <pre className="text-xs overflow-auto">
              {JSON.stringify(confirmation.responseData, null, 2)}
            </pre>
          </div>
        )}

        {confirmation.status === 'accepted' && (
          <div className="p-4 bg-green-50 border border-green-200 rounded">
            <p className="text-green-800 font-semibold">
              ✅ Filing accepted by HMRC
            </p>
            <p className="text-sm text-green-700 mt-1">
              Your filing has been successfully submitted and accepted.
            </p>
          </div>
        )}

        {confirmation.status === 'rejected' && (
          <div className="p-4 bg-red-50 border border-red-200 rounded">
            <p className="text-red-800 font-semibold">
              ❌ Filing rejected by HMRC
            </p>
            <p className="text-sm text-red-700 mt-1">
              Please review the rejection details and submit an amendment.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
