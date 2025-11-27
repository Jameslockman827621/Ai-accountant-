'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import FilingComparison from '@/components/FilingComparison';
import AmendmentWorkflow from '@/components/AmendmentWorkflow';
import HMRCReceiptsPanel from '@/components/HMRCReceiptsPanel';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

type ValidationCheck = {
  check: string;
  passed: boolean;
  required?: boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
};

type ValidationSnapshot = {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  checks: ValidationCheck[];
  confidence: number;
};

type ReviewChecklist = {
  checks: ValidationCheck[];
  canApprove: boolean;
  canReject: boolean;
};

type ComparisonField = {
  label: string;
  current: unknown;
  previous?: unknown;
};

const keyFields: Record<string, ComparisonField[]> = {
  vat: [
    { label: 'vatDueSales', current: undefined },
    { label: 'vatDueAcquisitions', current: undefined },
    { label: 'totalVatDue', current: undefined },
    { label: 'netVatDue', current: undefined },
  ],
  paye: [
    { label: 'totalPAYE', current: undefined },
    { label: 'employeeCount', current: undefined },
    { label: 'grossPay', current: undefined },
  ],
  corporation_tax: [
    { label: 'profit', current: undefined },
    { label: 'corporationTax', current: undefined },
  ],
};

export default function FilingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [filingId, setFilingId] = useState('');
  const [validation, setValidation] = useState<ValidationSnapshot | null>(null);
  const [checklist, setChecklist] = useState<ReviewChecklist | null>(null);
  const [comparison, setComparison] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [attestation, setAttestation] = useState({ name: '', role: '', statement: 'I confirm this filing is accurate.' });
  const [attestationMessage, setAttestationMessage] = useState<string | null>(null);
  const [artifactMessage, setArtifactMessage] = useState<string | null>(null);
  const [uploadingArtifact, setUploadingArtifact] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token');
    if (!storedToken) {
      router.push('/login');
      return;
    }
    setToken(storedToken);
  }, [router]);

  useEffect(() => {
    if (!token || !filingId) return;
    void runValidation();
    void loadChecklist();
    void loadComparison();
  }, [token, filingId]);

  const currentFields = useMemo(() => {
    if (!comparison?.currentFiling?.data) return [] as ComparisonField[];
    const type = String(comparison.currentFiling?.data?.filing_type || comparison.currentFiling?.filingType || 'vat');
    const fields = keyFields[type] || keyFields['vat'];
    return fields.map((field) => ({
      ...field,
      current: comparison.currentFiling.data[field.label],
      previous: comparison.previousFiling?.data?.[field.label],
    }));
  }, [comparison]);

  const runValidation = async () => {
    if (!token || !filingId) return;
    try {
      const response = await fetch(`${API_BASE}/api/filings/${filingId}/validate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Validation failed');
      const data = await response.json();
      setValidation(data.validation);
    } catch (error) {
      console.error(error);
      setValidation(null);
    }
  };

  const loadChecklist = async () => {
    if (!token || !filingId) return;
    try {
      const response = await fetch(`${API_BASE}/api/filings/${filingId}/review/checklist`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Checklist request failed');
      const data = await response.json();
      setChecklist(data.checklist || null);
      if (data.validation) {
        setValidation(data.validation);
      }
    } catch (error) {
      console.error(error);
      setChecklist(null);
    }
  };

  const loadComparison = async () => {
    if (!token || !filingId) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/filings/${filingId}/compare?type=both`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Comparison failed');
      const data = await response.json();
      setComparison(data.comparison);
    } catch (error) {
      console.error(error);
      setComparison(null);
    } finally {
      setLoading(false);
    }
  };

  const submitAttestation = async () => {
    if (!token || !filingId) return;
    try {
      setAttestationMessage(null);
      const response = await fetch(`${API_BASE}/api/filings/${filingId}/attest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          attestedByName: attestation.name,
          attestedByRole: attestation.role,
          statement: attestation.statement,
        }),
      });
      if (!response.ok) throw new Error('Could not save attestation');
      setAttestationMessage('E-signature captured and stored.');
    } catch (error) {
      setAttestationMessage(error instanceof Error ? error.message : 'Failed to save attestation');
    }
  };

  const uploadArtifact = async (file?: File | null) => {
    if (!token || !file) return;
    try {
      setUploadingArtifact(true);
      setArtifactMessage(null);
      const form = new FormData();
      form.append('file', file);
      form.append('documentType', 'filing_artifact');
      form.append('notes', `Receipt for filing ${filingId}`);
      const response = await fetch(`${API_BASE}/api/documents/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!response.ok) throw new Error('Upload failed');
      setArtifactMessage('Receipt artifact sent to document-ingest.');
    } catch (error) {
      setArtifactMessage(error instanceof Error ? error.message : 'Failed to upload artifact');
    } finally {
      setUploadingArtifact(false);
    }
  };

  if (!token) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto py-10 px-6 space-y-8">
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">Filings Reviewer</h1>
              <p className="text-sm text-gray-500">Run pre-filing validation, capture approvals, and review evidence.</p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={filingId}
                onChange={(e) => setFilingId(e.target.value)}
                placeholder="Enter filing ID"
                className="border px-3 py-2 rounded w-64"
              />
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded"
                onClick={() => {
                  void runValidation();
                  void loadComparison();
                  void loadChecklist();
                }}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white shadow rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Pre-filing Validation</h2>
                <p className="text-sm text-gray-500">Runs rulepacks, anomaly checks, and adapter coverage.</p>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-xs ${
                  validation?.isValid ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}
              >
                {validation?.isValid ? 'Passing' : 'Requires attention'}
              </span>
            </div>
            {validation ? (
              <div className="space-y-3">
                <div className="text-sm text-gray-600">Confidence: {(validation.confidence * 100).toFixed(1)}%</div>
                <ul className="space-y-2">
                  {validation.checks.map((check) => (
                    <li key={check.check} className="flex items-start gap-2">
                      <span className={`mt-1 h-2 w-2 rounded-full ${check.passed ? 'bg-green-500' : 'bg-red-500'}`} />
                      <div>
                        <p className="font-medium">{check.check}</p>
                        <p className="text-sm text-gray-600">{check.message}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                {validation.errors.length > 0 && (
                  <div className="p-3 rounded bg-red-50 text-sm text-red-700">
                    <p className="font-semibold mb-1">Errors</p>
                    <ul className="list-disc ml-4 space-y-1">
                      {validation.errors.map((err: string) => (
                        <li key={err}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-gray-500">Run validation to see checks.</p>
            )}
          </div>

          <div className="bg-white shadow rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Review Checklist</h2>
              <span className="text-sm text-gray-500">
                {checklist?.canApprove ? 'Ready for approval' : 'Pending requirements'}
              </span>
            </div>
            {checklist ? (
              <ul className="space-y-2">
                {checklist.checks.map((item) => (
                  <li key={item.check} className="flex items-start gap-2">
                    <span className={`mt-1 h-2 w-2 rounded-full ${item.passed ? 'bg-green-500' : 'bg-yellow-500'}`} />
                    <div>
                      <p className="font-medium">{item.check}</p>
                      <p className="text-sm text-gray-600">{item.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500">Checklist will appear once a filing is selected.</p>
            )}
          </div>
        </div>

        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Side-by-side Review</h2>
            {loading && <span className="text-sm text-gray-500">Loading comparison…</span>}
          </div>
          {comparison ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border rounded p-4">
                <h3 className="font-semibold mb-2">Period Overview</h3>
                <p className="text-sm text-gray-600">Current: {new Date(comparison.currentFiling.periodStart).toLocaleDateString()} - {new Date(comparison.currentFiling.periodEnd).toLocaleDateString()}</p>
                {comparison.previousFiling && (
                  <p className="text-sm text-gray-600">Previous: {new Date(comparison.previousFiling.periodStart).toLocaleDateString()} - {new Date(comparison.previousFiling.periodEnd).toLocaleDateString()}</p>
                )}
                <div className="mt-3 space-y-2">
                  {currentFields.map((field) => (
                    <div key={field.label} className="flex justify-between text-sm">
                      <span className="font-medium">{field.label}</span>
                      <span>
                        <span className="text-gray-700">{field.current ?? '—'}</span>
                        {field.previous !== undefined && (
                          <span className="text-gray-500 ml-2">(prev {field.previous ?? '—'})</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border rounded p-4">
                <FilingComparison filingId={filingId} comparisonType="both" />
              </div>
            </div>
          ) : (
            <p className="text-gray-500">Enter a filing to view comparison details.</p>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white shadow rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">E-sign Capture</h2>
              {attestationMessage && <span className="text-sm text-green-700">{attestationMessage}</span>}
            </div>
            <div className="space-y-3">
              <input
                type="text"
                value={attestation.name}
                onChange={(e) => setAttestation({ ...attestation, name: e.target.value })}
                placeholder="Signer name"
                className="w-full border px-3 py-2 rounded"
              />
              <input
                type="text"
                value={attestation.role}
                onChange={(e) => setAttestation({ ...attestation, role: e.target.value })}
                placeholder="Signer role"
                className="w-full border px-3 py-2 rounded"
              />
              <textarea
                value={attestation.statement}
                onChange={(e) => setAttestation({ ...attestation, statement: e.target.value })}
                className="w-full border px-3 py-2 rounded"
                rows={3}
              />
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded"
                onClick={submitAttestation}
              >
                Capture signature
              </button>
            </div>
          </div>

          <div className="bg-white shadow rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Receipt artifacts</h2>
              {artifactMessage && <span className="text-sm text-green-700">{artifactMessage}</span>}
            </div>
            <div className="space-y-3">
              <input
                type="file"
                onChange={(e) => uploadArtifact(e.target.files?.[0])}
                className="w-full"
                disabled={uploadingArtifact}
              />
              <p className="text-sm text-gray-600">Uploads are forwarded to document-ingest for downstream classification.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white shadow rounded-lg p-6">
            <AmendmentWorkflow filingId={filingId} token={token} onAmendmentSubmit={loadComparison} />
          </div>
          <HMRCReceiptsPanel token={token} />
        </div>
      </div>
    </div>
  );
}
