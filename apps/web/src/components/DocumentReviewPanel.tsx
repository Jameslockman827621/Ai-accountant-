'use client';

import { useCallback, useEffect, useState } from 'react';
import DocumentReview, { ReviewDocumentData, AssistantSuggestion, AuditLogEntry } from './DocumentReview';

interface ReviewQueueItem {
  documentId: string;
  fileName: string;
  documentType: string | null;
  confidenceScore: number | null;
  reason?: string;
}

interface DocumentReviewPanelProps {
  token: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

async function apiRequest<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json() as Promise<T>;
}

export default function DocumentReviewPanel({ token }: DocumentReviewPanelProps) {
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<ReviewDocumentData | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AssistantSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  const [auditLogError, setAuditLogError] = useState<string | null>(null);

  const fetchDocument = useCallback(async (documentId: string | null, queueOverride?: ReviewQueueItem[]) => {
    if (!documentId) {
      setSelectedDocument(null);
      setSuggestions([]);
      setAuditLog([]);
      return;
    }

    setDocumentLoading(true);
    setError(null);

    try {
      const data = await apiRequest<{ document: Record<string, unknown> }>(
        `/api/documents/${documentId}`,
        token
      );

      const doc = data.document as {
        id: string;
        file_name: string;
        document_type: string | null;
        confidence_score: number | null;
        extracted_data: ReviewDocumentData['extractedData'];
        status: string;
      };

      const activeQueue = queueOverride || queue;
      const queueItem = activeQueue.find(item => item.documentId === documentId);

        const nextDocument: ReviewDocumentData = {
        id: doc.id,
        fileName: doc.file_name,
        documentType: doc.document_type,
        confidenceScore: doc.confidence_score,
        status: doc.status,
      };
        if (doc.extracted_data !== undefined) {
          nextDocument.extractedData = doc.extracted_data ?? null;
        }
      if (queueItem?.reason) {
        nextDocument.reason = queueItem.reason;
      }

      setSelectedDocument(nextDocument);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load document details');
    } finally {
      setDocumentLoading(false);
    }
  }, [token, queue]);

  const refreshQueue = useCallback(async () => {
    setQueueLoading(true);
    setError(null);
    try {
      const data = await apiRequest<{
        queue: Array<
          ReviewQueueItem & {
            extractedData?: Record<string, unknown>;
            requiresReview: boolean;
          }
        >;
      }>('/api/documents/review/queue', token);
      const items: ReviewQueueItem[] = data.queue.map((item) => {
        const queueEntry: ReviewQueueItem = {
          documentId: item.documentId,
          fileName: item.fileName,
          documentType: item.documentType,
          confidenceScore: item.confidenceScore,
        };
        if (item.reason) {
          queueEntry.reason = item.reason;
        }
        return queueEntry;
      });

      setQueue(items);

      let nextSelectedId: string | null = selectedId;
      if (!nextSelectedId || !items.some(item => item.documentId === nextSelectedId)) {
        nextSelectedId = items[0]?.documentId || null;
        setSelectedId(nextSelectedId);
      }

      if (nextSelectedId) {
        await fetchDocument(nextSelectedId, items);
      } else {
        setSelectedDocument(null);
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load review queue');
    } finally {
      setQueueLoading(false);
    }
  }, [fetchDocument, selectedId, token]);

  useEffect(() => {
    refreshQueue();
  }, [refreshQueue]);

  const handleSelect = async (documentId: string) => {
    setSelectedId(documentId);
    await fetchDocument(documentId);
  };

  const handleSave = async (data: ReviewDocumentData['extractedData']) => {
    if (!selectedId) return;
    setActionLoading(true);
    setStatusMessage(null);
    setError(null);
    try {
      await apiRequest(
        `/api/documents/${selectedId}/extracted-data`,
        token,
        {
          method: 'PUT',
          body: JSON.stringify({ extractedData: data }),
        }
      );
      setStatusMessage('Changes saved successfully.');
      await refreshQueue();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedId) return;
    setActionLoading(true);
    setStatusMessage(null);
    setError(null);
    try {
      await apiRequest(
        `/api/documents/${selectedId}/approve`,
        token,
        { method: 'POST' }
      );
      setStatusMessage('Document approved and ready for posting.');
      await refreshQueue();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to approve document');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (reason: string) => {
    if (!selectedId) return;
    setActionLoading(true);
    setStatusMessage(null);
    setError(null);
    try {
      await apiRequest(
        `/api/documents/${selectedId}/reject`,
        token,
        {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }
      );
      setStatusMessage('Document rejected and flagged for follow-up.');
      await refreshQueue();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to reject document');
    } finally {
      setActionLoading(false);
    }
  };

  const fetchSuggestions = useCallback(async (documentId: string) => {
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    try {
      const data = await apiRequest<{ suggestions: AssistantSuggestion[] }>(
        `/api/assistant/documents/${documentId}/suggestions`,
        token
      );
      setSuggestions(data.suggestions);
    } catch (err) {
      console.error(err);
      setSuggestions([]);
      setSuggestionsError(err instanceof Error ? err.message : 'Unable to fetch assistant suggestions');
    } finally {
      setSuggestionsLoading(false);
    }
  }, [token]);

  const fetchAuditLog = useCallback(async (documentId: string) => {
    setAuditLogLoading(true);
    setAuditLogError(null);
    try {
      const data = await apiRequest<{ auditLog: AuditLogEntry[] }>(
        `/api/documents/${documentId}/audit-log`,
        token
      );
      setAuditLog(data.auditLog);
    } catch (err) {
      console.error(err);
      setAuditLog([]);
      setAuditLogError(err instanceof Error ? err.message : 'Unable to fetch audit history');
    } finally {
      setAuditLogLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!selectedId) {
      setSuggestions([]);
      setAuditLog([]);
      return;
    }
    setSuggestionsError(null);
    setAuditLogError(null);
    setSuggestions([]);
    setAuditLog([]);
    void fetchSuggestions(selectedId);
    void fetchAuditLog(selectedId);
  }, [selectedId, fetchAuditLog, fetchSuggestions]);

  const insightsError = suggestionsError || auditLogError;

  return (
    <section className="bg-white rounded-lg shadow p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Manual Review Queue</h2>
          <p className="text-sm text-gray-500">
            Documents that need human verification before posting to the ledger.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refreshQueue}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            disabled={queueLoading}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {statusMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
          {statusMessage}
        </div>
      )}

        {insightsError && (
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded text-sm">
            {insightsError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Queue</h3>
            <div className="border rounded-lg divide-y bg-gray-50 max-h-[420px] overflow-y-auto">
              {queueLoading && queue.length === 0 && (
                <div className="p-4 text-sm text-gray-500">Loading queue…</div>
              )}
              {!queueLoading && queue.length === 0 && (
                <div className="p-4 text-sm text-gray-500">
                  All caught up! No documents need manual review right now.
                </div>
              )}
              {queue.map(item => {
                const isSelected = item.documentId === selectedId;
                return (
                  <button
                    key={item.documentId}
                    type="button"
                    onClick={() => handleSelect(item.documentId)}
                    className={`w-full text-left p-4 space-y-2 focus:outline-none ${
                      isSelected ? 'bg-white shadow-inner' : 'hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-sm">{item.fileName}</p>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          (item.confidenceScore || 0) >= 0.85
                            ? 'bg-green-100 text-green-800'
                            : (item.confidenceScore || 0) >= 0.7
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {(item.confidenceScore ?? 0).toFixed(2)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 capitalize">{item.documentType || 'Unknown type'}</p>
                    {item.reason && (
                      <p className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-100 rounded px-2 py-1">
                        {item.reason}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-2">
            <DocumentReview
              document={selectedDocument}
              isLoading={documentLoading && !selectedDocument}
              actionLoading={actionLoading}
              onApprove={handleApprove}
              onReject={handleReject}
              onEdit={handleSave}
              suggestions={suggestions}
              suggestionsLoading={suggestionsLoading}
              auditLog={auditLog}
              auditLogLoading={auditLogLoading}
              token={token}
            />
          </div>
        </div>
    </section>
  );
}
