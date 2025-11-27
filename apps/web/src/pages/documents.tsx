import { useEffect, useMemo, useState, ChangeEvent } from 'react';

interface DocumentRow {
  id: string;
  file_name: string;
  status: string;
  quality_score?: number | null;
  quality_gate_status?: 'passed' | 'needs_review';
  quality_issues?: Array<{ id: string; severity: string; message: string }>;
  confidence_score?: number | null;
  created_at?: string;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadDocuments = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/documents?limit=50');
      if (!response.ok) {
        throw new Error('Failed to load documents');
      }
      const data = await response.json();
      setDocuments(data.documents || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load documents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments().catch(() => undefined);
  }, []);

  const handleRetry = async (documentId: string): Promise<void> => {
    setMessage(null);
    setError(null);
    const response = await fetch(`/api/documents/${documentId}/retry`, { method: 'POST' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error || 'Unable to queue OCR');
      return;
    }
    setMessage('Queued OCR retry for selected document');
    await loadDocuments();
  };

  const handleReupload = async (
    event: ChangeEvent<HTMLInputElement>,
    documentId: string
  ): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;

    setMessage(null);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('source', 'dashboard');
    formData.append('notes', `Re-uploaded for document ${documentId}`);

    const response = await fetch('/api/documents/upload', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error || 'Failed to re-upload document');
      return;
    }

    setMessage('Replacement upload submitted. It will appear in the list shortly.');
    await loadDocuments();
  };

  const derivedQualityStatus = (doc: DocumentRow): 'passed' | 'needs_review' => {
    if (doc.quality_gate_status) return doc.quality_gate_status;
    if (typeof doc.quality_score === 'number' && doc.quality_score < 70) return 'needs_review';
    if (doc.quality_issues?.some(issue => issue.severity === 'critical')) return 'needs_review';
    return 'passed';
  };

  const qualityBadge = (status: 'passed' | 'needs_review'): string => {
    return status === 'passed'
      ? 'bg-green-100 text-green-800'
      : 'bg-yellow-100 text-yellow-800';
  };

  const qcSummary = useMemo(() => {
    const total = documents.length || 1;
    const blocked = documents.filter(doc => derivedQualityStatus(doc) === 'needs_review').length;
    return { total, blocked };
  }, [documents]);

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Documents</h1>
            <p className="text-sm text-gray-600">
              Track quality control results before OCR. Resolve holds by re-uploading or forcing OCR.
            </p>
          </div>
          <button
            type="button"
            onClick={loadDocuments}
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-blue-600 shadow-sm ring-1 ring-blue-200 hover:bg-blue-50"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">Documents tracked</p>
            <p className="text-2xl font-semibold text-gray-900">{qcSummary.total}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">Needs quality review</p>
            <p className="text-2xl font-semibold text-amber-700">{qcSummary.blocked}</p>
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}
        {message && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">{message}</div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">File</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">QC</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Quality</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">OCR confidence</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">
                    Loading documents…
                  </td>
                </tr>
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">
                    No documents available yet.
                  </td>
                </tr>
              ) : (
                documents.map((doc) => {
                  const qcStatus = derivedQualityStatus(doc);
                  return (
                    <tr key={doc.id} className="text-sm text-gray-800">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{doc.file_name}</div>
                        <div className="text-xs text-gray-500">{doc.status}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${qualityBadge(qcStatus)}`}>
                          {qcStatus === 'passed' ? 'Passed pre-OCR checks' : 'Needs human review'}
                        </span>
                        {doc.quality_issues?.length && (
                          <p className="mt-1 text-xs text-gray-500">{doc.quality_issues[0].message}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {typeof doc.quality_score === 'number' ? `${doc.quality_score.toFixed(0)} / 100` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {typeof doc.confidence_score === 'number'
                          ? `${Math.round(doc.confidence_score * 100)}%`
                          : 'Pending'}
                      </td>
                      <td className="px-4 py-3 space-y-2">
                        <button
                          type="button"
                          onClick={() => handleRetry(doc.id)}
                          className="mr-2 rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          Accept & run OCR
                        </button>
                        <label className="inline-flex cursor-pointer items-center rounded-lg bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-800 hover:bg-gray-200">
                          Re-upload
                          <input
                            type="file"
                            className="hidden"
                            accept="application/pdf,image/png,image/jpeg"
                            onChange={(event) => handleReupload(event, doc.id)}
                          />
                        </label>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
