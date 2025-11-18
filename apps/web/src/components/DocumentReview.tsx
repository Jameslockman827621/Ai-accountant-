'use client';

import React, { useEffect, useMemo, useState } from 'react';
import AssistantChat from './AssistantChat';

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

export interface AssistantSuggestion {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  recommendedAction?: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  message: string;
  userName?: string | null;
  userEmail?: string | null;
  createdAt: string;
  changes?: Record<string, unknown> | null;
}

interface DocumentReviewProps {
  document: ReviewDocumentData | null;
  isLoading?: boolean;
  actionLoading?: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onEdit: (data: ReviewDocumentData['extractedData']) => void;
  suggestions?: AssistantSuggestion[];
  suggestionsLoading?: boolean;
  auditLog?: AuditLogEntry[];
  auditLogLoading?: boolean;
  token: string;
}

export default function DocumentReview({
  document,
  isLoading = false,
  actionLoading = false,
  onApprove,
  onReject,
  onEdit,
  suggestions = [],
  suggestionsLoading = false,
  auditLog = [],
  auditLogLoading = false,
  token,
}: DocumentReviewProps) {
  type EditableData = NonNullable<ReviewDocumentData['extractedData']>;

  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<EditableData>({});
  const [assistantOpen, setAssistantOpen] = useState(false);

    useEffect(() => {
      setIsEditing(false);
      setEditedData((document?.extractedData as EditableData) || {});
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

    const suggestionColors: Record<AssistantSuggestion['severity'], string> = {
      info: 'border-blue-200 bg-blue-50',
      warning: 'border-yellow-200 bg-yellow-50',
      critical: 'border-red-200 bg-red-50',
    };

    const suggestionBadgeColors: Record<AssistantSuggestion['severity'], string> = {
      info: 'bg-blue-100 text-blue-800',
      warning: 'bg-yellow-100 text-yellow-800',
      critical: 'bg-red-100 text-red-800',
    };

    const assistantPrompt = document
      ? `Provide review guidance for document ${document.id} (${document.documentType || 'unknown type'})`
      : 'Provide assistance with pending document review tasks.';

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

  const formatDateTime = (value: string): string => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }
    return parsed.toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
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
    <div className="bg-white rounded-lg shadow p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">{document.fileName}</h3>
          <p className="text-sm text-gray-500">Type: {document.documentType || 'Unknown'}</p>
        </div>
        <div className={`px-3 py-1 rounded text-sm font-semibold ${badgeClasses[confidenceColor]}`}>
          Confidence: {(((document.confidenceScore || 0) * 100)).toFixed(0)}%
        </div>
      </div>

      {document.reason && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
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
                  value={editedData.total ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEditedData((prev) => {
                      const updated = { ...prev };
                      if (value === '') {
                        delete updated.total;
                      } else {
                        updated.total = Number(value);
                      }
                      return updated;
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
                  value={editedData.tax ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    setEditedData((prev) => {
                      const updated = { ...prev };
                      if (value === '') {
                        delete updated.tax;
                      } else {
                        updated.tax = Number(value);
                      }
                      return updated;
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
                value={editedData.invoiceNumber || ''}
                onChange={(e) => setEditedData({ ...editedData, invoiceNumber: e.target.value })}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div className="flex space-x-2">
            <button
                onClick={() => onEdit(editedData)}
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
        <div className="space-y-3">
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
            <button
              onClick={() => setAssistantOpen((prev) => !prev)}
              className="px-4 py-2 border border-blue-200 text-blue-700 rounded hover:bg-blue-50"
            >
              {assistantOpen ? 'Hide Assistant' : 'Ask Assistant'}
            </button>
          </>
        )}
      </div>

      {assistantOpen && (
        <div className="mt-4 border rounded-lg">
          <AssistantChat token={token} initialPrompt={assistantPrompt} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="border rounded-lg p-4 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="font-semibold text-gray-800">Assistant Suggestions</h4>
              <p className="text-xs text-gray-500">AI checks specific to this document.</p>
            </div>
            {suggestionsLoading && <span className="text-xs text-gray-500">Updating…</span>}
          </div>
          {suggestionsLoading ? (
            <p className="text-sm text-gray-500">Generating suggestions…</p>
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-gray-500">No suggestions at this time.</p>
          ) : (
            <div className="space-y-3">
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  className={`rounded-lg border p-3 ${suggestionColors[suggestion.severity]}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-sm text-gray-900">{suggestion.title}</p>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${suggestionBadgeColors[suggestion.severity]}`}>
                      {suggestion.severity}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700">{suggestion.message}</p>
                  {suggestion.recommendedAction && (
                    <p className="text-xs text-gray-600 mt-1">
                      Recommended: {suggestion.recommendedAction}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border rounded-lg p-4 bg-gray-50">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="font-semibold text-gray-800">Audit History</h4>
              <p className="text-xs text-gray-500">Recent edits and actions on this document.</p>
            </div>
            {auditLogLoading && <span className="text-xs text-gray-500">Refreshing…</span>}
          </div>
          {auditLogLoading ? (
            <p className="text-sm text-gray-500">Loading audit entries…</p>
          ) : auditLog.length === 0 ? (
            <p className="text-sm text-gray-500">No audit entries yet.</p>
          ) : (
            <ul className="space-y-3">
              {auditLog.map((entry) => (
                <li key={entry.id} className="rounded bg-white border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm text-gray-900">{entry.message}</p>
                    <span className="text-xs text-gray-500">{formatDateTime(entry.createdAt)}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {entry.userName || entry.userEmail || 'System'}
                  </p>
                  {entry.changes && (
                    <details className="mt-2 text-xs text-gray-600">
                      <summary className="cursor-pointer text-blue-600">View details</summary>
                      <pre className="mt-1 bg-gray-100 rounded p-2 overflow-auto">
                        {JSON.stringify(entry.changes, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
