'use client';

import { useCallback, useMemo, useState } from 'react';
import { DocumentChecklistItem, DocumentQualityIssue, DocumentType } from '@ai-accountant/shared-types';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

type UploadVariant = 'panel' | 'compact';

const DOCUMENT_GUIDANCE: Record<
  DocumentType,
  { label: string; description: string; tips: string[] }
> = {
  [DocumentType.INVOICE]: {
    label: 'Invoice',
    description: 'Issued by a supplier, usually multi-line with VAT breakdown.',
    tips: ['Ensure invoice number and dates are visible', 'Show subtotal, tax and total', 'Avoid scanning in grayscale if possible'],
  },
  [DocumentType.RECEIPT]: {
    label: 'Receipt',
    description: 'Till receipt or card slip proving payment.',
    tips: ['Flatten crumpled receipts before taking a photo', 'Capture the full width of the receipt', 'Keep the lighting even to avoid glare'],
  },
  [DocumentType.STATEMENT]: {
    label: 'Bank statement',
    description: 'Monthly bank export (PDF or CSV).',
    tips: ['Upload one statement per month', 'Split very long PDFs into smaller sections', 'Prefer PDF exports over screenshots'],
  },
  [DocumentType.PAYSLIP]: {
    label: 'Payslip',
    description: 'Payroll summary per employee.',
    tips: ['Include employer and employee names', 'Show gross, net and deductions clearly', 'Mask NI numbers if sharing externally'],
  },
  [DocumentType.TAX_FORM]: {
    label: 'Tax form',
    description: 'HMRC letters, VAT returns, PAYE filings.',
    tips: ['Include the HMRC reference/UTR', 'Show filing period or due date', 'Upload the full notice rather than cropped sections'],
  },
  [DocumentType.OTHER]: {
    label: 'Other document',
    description: 'Anything else (contracts, letters, supporting docs).',
    tips: ['Add context in the notes field', 'Highlight the figures we should rely on', 'Upload a PDF for multi-page material'],
  },
};

const SEVERITY_STYLES: Record<
  DocumentQualityIssue['severity'],
  { badge: string; text: string; bg: string }
> = {
  info: {
    badge: 'bg-blue-100 text-blue-800',
    text: 'text-blue-900',
    bg: 'bg-blue-50',
  },
  warning: {
    badge: 'bg-amber-100 text-amber-800',
    text: 'text-amber-900',
    bg: 'bg-amber-50',
  },
  critical: {
    badge: 'bg-red-100 text-red-800',
    text: 'text-red-900',
    bg: 'bg-red-50',
  },
};

interface DocumentUploadProps {
  token: string;
  onUpload?: () => void;
  source?: 'dashboard' | 'onboarding';
  variant?: UploadVariant;
  defaultType?: DocumentType;
}

interface UploadResponse {
  document: {
    id: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    status: string;
    documentType?: DocumentType;
    qualityScore?: number;
    qualityIssues?: DocumentQualityIssue[];
    uploadChecklist?: DocumentChecklistItem[];
    pageCount?: number;
    suggestedDocumentType?: DocumentType;
  };
  guidance?: {
    score: number;
    issues: DocumentQualityIssue[];
    checklist: DocumentChecklistItem[];
    pageCount: number;
    suggestedType: DocumentType;
  };
}

export default function DocumentUpload({
  token,
  onUpload,
  source = 'dashboard',
  variant = 'panel',
  defaultType,
}: DocumentUploadProps) {
  const [docType, setDocType] = useState<DocumentType | ''>(defaultType ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [quality, setQuality] = useState<{
    score: number;
    issues: DocumentQualityIssue[];
    checklist: DocumentChecklistItem[];
    pageCount?: number;
    suggestedType?: DocumentType;
  } | null>(null);

  const isCompact = variant === 'compact';
  const guidance = docType ? DOCUMENT_GUIDANCE[docType] : null;
  const disableUpload = !file || !docType || uploading;

  const handleFileSelect = useCallback((selectedFile: File | null) => {
    setFile(selectedFile);
    setQuality(null);
    setError(null);
    setStatus(null);
  }, []);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      handleFileSelect(event.target.files[0]);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files && event.dataTransfer.files[0]) {
      handleFileSelect(event.dataTransfer.files[0]);
    }
  };

  const handleUpload = async () => {
    if (disableUpload || !file || !docType) return;
    setUploading(true);
    setError(null);
    setStatus('Uploading…');
    setQuality(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', docType);
      if (notes.trim()) {
        formData.append('notes', notes.trim());
      }
      formData.append('source', source);

      const response = await fetch(`${API_BASE}/api/documents/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Upload failed');
      }

      const data: UploadResponse = await response.json();
      const insight = data.guidance
        ? {
            score: data.guidance.score,
            issues: data.guidance.issues,
            checklist: data.guidance.checklist,
            pageCount: data.guidance.pageCount,
            suggestedType: data.guidance.suggestedType,
          }
        : {
            score: data.document.qualityScore ?? 0,
            issues: data.document.qualityIssues ?? [],
            checklist: data.document.uploadChecklist ?? [],
            pageCount: data.document.pageCount,
            suggestedType: data.document.suggestedDocumentType,
          };

      setQuality(insight);
      setStatus('Document uploaded successfully.');
      handleFileSelect(null);
      setNotes('');
      onUpload?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setStatus(null);
    } finally {
      setUploading(false);
    }
  };

  const checklistToRender = useMemo(() => {
    if (quality?.checklist) {
      return quality.checklist;
    }
    if (guidance?.tips) {
      return guidance.tips.map((tip, index) => ({
        id: `${docType}-tip-${index}`,
        label: tip,
        completed: true,
      }));
    }
    return [];
  }, [quality?.checklist, guidance, docType]);

  return (
    <section
      className={`rounded-2xl border ${
        isCompact ? 'border-blue-100 bg-white' : 'border-gray-200 bg-white'
      } p-4 sm:p-6 space-y-6`}
    >
      <header className="space-y-2">
        <p className="text-sm font-semibold text-blue-600">Guided upload</p>
        <h3 className="text-xl font-semibold text-gray-900">
          Share a {docType ? DOCUMENT_GUIDANCE[docType].label.toLowerCase() : 'document'}
        </h3>
        <p className="text-sm text-gray-600">
          We’ll run quality checks, route the file through OCR, and surface it in the review queue automatically.
        </p>
      </header>

      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">1. What are you uploading?</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(DOCUMENT_GUIDANCE).map(([type, meta]) => (
            <button
              key={type}
              type="button"
              onClick={() => setDocType(type as DocumentType)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                docType === type
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-700 hover:border-blue-200'
              }`}
            >
              {meta.label}
            </button>
          ))}
        </div>
        {guidance && !isCompact && (
          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
            <p className="text-sm font-semibold text-blue-900">{guidance.label}</p>
            <p className="text-sm text-blue-900/80">{guidance.description}</p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-gray-700">2. Drag the file or pick from your device</p>
        <label
          onDragOver={event => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={event => {
            event.preventDefault();
            setDragActive(false);
          }}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition ${
            dragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50'
          }`}
        >
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.csv" className="hidden" onChange={handleInputChange} />
          <p className="text-sm font-medium text-gray-700">
            {file ? file.name : 'Drop a PDF, JPG, PNG, or CSV here'}
          </p>
          <p className="text-xs text-gray-500">Max 50MB. We'll auto-detect orientation and run OCR.</p>
        </label>
        {file && (
          <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
            <div>
              <p className="font-medium text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500">
                {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type || 'unknown type'}
              </p>
            </div>
            <button type="button" className="text-xs font-medium text-blue-600" onClick={() => handleFileSelect(null)}>
              Remove
            </button>
          </div>
        )}
      </div>

      {!isCompact && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700" htmlFor="document-notes">
            3. Add context (optional)
          </label>
          <textarea
            id="document-notes"
            rows={3}
            value={notes}
            onChange={event => setNotes(event.target.value)}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="e.g. “January rent invoice” or “HMRC VAT assessment for Q1”"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleUpload}
          disabled={disableUpload}
          className="inline-flex items-center justify-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200"
        >
          {uploading ? 'Uploading…' : 'Upload & run checks'}
        </button>
        <p className="text-xs text-gray-500">
          We’ll score legibility, auto-tag the file, and queue it for extraction immediately.
        </p>
      </div>

      {status && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">{status}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
      )}

      {(quality || checklistToRender.length > 0) && (
        <div className="space-y-4 rounded-2xl border border-gray-100 bg-gray-50/80 p-4">
          {quality && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-700">Quality score</p>
                <p className="text-2xl font-bold text-gray-900">{quality.score.toFixed(0)} / 100</p>
                {quality.suggestedType && quality.suggestedType !== docType && (
                  <p className="text-xs text-gray-500">
                    Looks like a {DOCUMENT_GUIDANCE[quality.suggestedType].label.toLowerCase()}.
                  </p>
                )}
              </div>
              <div className="w-full max-w-xs">
                <div className="h-2 rounded-full bg-gray-200">
                  <div
                    className="h-2 rounded-full bg-blue-600"
                    style={{ width: `${Math.min(quality.score, 100)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {quality?.issues?.length ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-700">Issues to review</p>
                <ul className="space-y-2">
                  {quality.issues.map(issue => (
                    <li
                      key={issue.id}
                      className={`rounded-xl ${SEVERITY_STYLES[issue.severity].bg} p-3 text-sm ${SEVERITY_STYLES[issue.severity].text}`}
                    >
                      <span className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_STYLES[issue.severity].badge}`}>
                        {issue.severity}
                      </span>
                      <p className="font-medium">{issue.message}</p>
                      {issue.recommendation && <p className="text-xs">{issue.recommendation}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="rounded-xl border border-green-100 bg-green-50/60 p-3 text-sm text-green-900">
                No blocking issues detected. We’ll continue processing automatically.
              </div>
            )}

            {checklistToRender.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-700">Checklist</p>
                <ul className="space-y-2 text-sm text-gray-700">
                  {checklistToRender.map(item => (
                    <li key={item.id} className="flex items-start gap-2">
                      <span
                        className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                          item.completed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {item.completed ? '✓' : '!'}
                      </span>
                      <span>{item.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
