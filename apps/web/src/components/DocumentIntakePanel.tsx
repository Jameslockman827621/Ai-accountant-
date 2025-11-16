'use client';

import { useCallback, useEffect, useState } from 'react';
import DocumentUpload from './DocumentUpload';
import { DocumentQualityIssue, DocumentType } from '@ai-accountant/shared-types';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface RecentDocument {
  id: string;
  file_name: string;
  document_type: DocumentType | null;
  status: string;
  created_at: string;
  quality_score: number | null;
  quality_issues: DocumentQualityIssue[] | null;
}

interface DocumentIntakePanelProps {
  token: string;
}

export default function DocumentIntakePanel({ token }: DocumentIntakePanelProps) {
  const [recent, setRecent] = useState<RecentDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/documents?limit=5`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        throw new Error('Failed to load recent documents');
      }
      const data = await response.json();
      setRecent(data.documents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load documents');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchRecent().catch(() => undefined);
  }, [fetchRecent]);

  return (
    <section className="space-y-6">
      <DocumentUpload token={token} onUpload={fetchRecent} source="dashboard" />

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-500">Recently submitted</p>
            <p className="text-lg font-semibold text-gray-900">Tracking the last five documents</p>
          </div>
          <button
            type="button"
            onClick={fetchRecent}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="text-sm text-gray-500">
            No uploads yet. Once you send files, they’ll appear here with a quality badge and status.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recent.map(doc => (
              <li key={doc.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <p className="font-medium text-gray-900">{doc.file_name}</p>
                  <p className="text-xs text-gray-500">
                    {doc.document_type ? doc.document_type.replace('_', ' ') : 'Unclassified'} ·{' '}
                    {new Date(doc.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                      doc.status === 'error'
                        ? 'bg-red-100 text-red-700'
                        : doc.status === 'posted'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {doc.status}
                  </span>
                  {typeof doc.quality_score === 'number' && (
                    <span className="text-xs text-gray-500">Quality {doc.quality_score.toFixed(0)} / 100</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
