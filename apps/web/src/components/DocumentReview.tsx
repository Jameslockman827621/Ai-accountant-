'use client';

import React, { useEffect, useMemo, useState } from 'react';

export interface ReviewDocumentData {
  id: string;
  fileName: string;
  documentType?: string | null;
  confidenceScore?: number | null;
  extractedData?: {
    vendor?: string;
    date?: string;
    total?: number | string;
    tax?: number | string;
    invoiceNumber?: string;
  } | null;
  status: string;
  reason?: string;
}

interface DocumentReviewProps {
  document: ReviewDocumentData | null;
  isLoading?: boolean;
  actionLoading?: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onEdit: (data: ReviewDocumentData['extractedData']) => void;
}

export default function DocumentReview({
  document,
  isLoading = false,
  actionLoading = false,
  onApprove,
  onReject,
  onEdit,
}: DocumentReviewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<ReviewDocumentData['extractedData']>({});

  useEffect(() => {
    setIsEditing(false);
    setEditedData(document?.extractedData || {});
  }, [document]);

  const confidenceColor = useMemo(() => {
    const score = document?.confidenceScore ?? 0;
    if (score >= 0.85) return 'green';
    if (score >= 0.7) return 'yellow';
    return 'red';
  }, [document?.confidenceScore]);

  const badgeClasses: Record<string, string> = {
    green: 'bg-green-100 text-green-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    red: 'bg-red-100 text-red-800',
  };

  const formatCurrency = (value?: number | string | null): string => {
    if (typeof value === 'number') {
      return value.toFixed(2);
    }
    if (typeof value === 'string') {
      const num = Number(value);
      if (!Number.isNaN(num)) {
        return num.toFixed(2);
      }
    }
    return '0.00';
  };

  const getDateInputValue = (value?: string): string => {
    if (!value) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  };

  const formatDisplayDate = (value?: string): string => {
    if (!value) {
      return 'N/A';
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleDateString('en-GB');
  };

  if (isLoading) {
    return <div className="bg-white rounded-lg shadow p-6">Loading document…</div>;
  }

  if (!document) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-gray-500">
        Select a document from the queue to review its details.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-xl font-semibold">{document.fileName}</h3>
          <p className="text-sm text-gray-500">Type: {document.documentType || 'Unknown'}</p>
        </div>
        <div className={`px-3 py-1 rounded text-sm font-semibold ${badgeClasses[confidenceColor]}`}>
          Confidence: {(((document.confidenceScore || 0) * 100)).toFixed(0)}%
        </div>
      </div>

      {document.reason && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
          <p className="text-sm text-yellow-800 font-medium">Review required</p>
          <p className="text-yellow-800 text-sm">{document.reason}</p>
        </div>
      )}

      {isEditing ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Vendor</label>
            <input
              type="text"
              value={editedData?.vendor || ''}
              onChange={(e) => setEditedData({ ...editedData, vendor: e.target.value })}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input
              type="date"
              value={getDateInputValue(editedData?.date)}
              onChange={(e) => setEditedData({ ...editedData, date: e.target.value })}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Total</label>
              <input
                type="number"
                step="0.01"
                value={editedData?.total ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setEditedData({
                    ...editedData,
                    total: value === '' ? undefined : Number(value),
                  });
                }}
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tax</label>
              <input
                type="number"
                step="0.01"
                value={editedData?.tax ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setEditedData({
                    ...editedData,
                    tax: value === '' ? undefined : Number(value),
                  });
                }}
                className="w-full border rounded px-3 py-2"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Invoice Number</label>
            <input
              type="text"
              value={editedData?.invoiceNumber || ''}
              onChange={(e) => setEditedData({ ...editedData, invoiceNumber: e.target.value })}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div className="flex space-x-2">
            <button
              onClick={() => onEdit(editedData || {})}
              disabled={actionLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Save Changes
            </button>
            <button
              onClick={() => {
                setEditedData(document.extractedData || {});
                setIsEditing(false);
              }}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 mb-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Vendor</p>
              <p className="font-medium">{document.extractedData?.vendor || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Date</p>
              <p className="font-medium">
                {formatDisplayDate(document.extractedData?.date || undefined)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Total</p>
              <p className="font-medium">£{formatCurrency(document.extractedData?.total)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Tax</p>
              <p className="font-medium">£{formatCurrency(document.extractedData?.tax)}</p>
            </div>
            {document.extractedData?.invoiceNumber && (
              <div>
                <p className="text-sm text-gray-500">Invoice Number</p>
                <p className="font-medium">{document.extractedData.invoiceNumber}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!isEditing && (
          <>
            <button
              onClick={() => setIsEditing(true)}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Edit
            </button>
            <button
              onClick={onApprove}
              disabled={actionLoading}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => {
                const reason = window.prompt('Reason for rejection (required):');
                if (reason) {
                  onReject(reason);
                }
              }}
              disabled={actionLoading}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}
