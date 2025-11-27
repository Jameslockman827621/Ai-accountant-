'use client';

import React, { useMemo, useState } from 'react';
import { PolicyStatus } from '@/hooks/useLegalAgreements';

interface TermsAcceptanceModalProps {
  policies: PolicyStatus[];
  outstandingPolicies: PolicyStatus[];
  onAccept: (signature: string) => Promise<void>;
  loading?: boolean;
  error?: string | null;
  userName?: string;
}

export function TermsAcceptanceModal({
  policies,
  outstandingPolicies,
  onAccept,
  loading,
  error,
  userName,
}: TermsAcceptanceModalProps) {
  const [signature, setSignature] = useState(userName || '');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const outstandingKeys = useMemo(
    () => new Set(outstandingPolicies.map(policy => policy.policy.policyType)),
    [outstandingPolicies]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!signature.trim()) {
      setFormError('Please sign with your name to continue.');
      return;
    }

    try {
      setSubmitting(true);
      await onAccept(signature.trim());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save acceptance');
    } finally {
      setSubmitting(false);
    }
  };

  const renderPolicy = (policy: PolicyStatus) => {
    const accepted = policy.accepted && !outstandingKeys.has(policy.policy.policyType);
    return (
      <div key={policy.policy.policyType} className="rounded-md border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">{policy.policy.title}</p>
            <p className="text-xs text-gray-500">
              Version {policy.policy.version} · Effective {new Date(policy.policy.effectiveAt).toLocaleDateString()}
            </p>
          </div>
          <span
            className={`rounded-full px-2 py-1 text-xs font-semibold ${accepted ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}
          >
            {accepted ? 'Accepted' : 'Action required'}
          </span>
        </div>
        <p className="mt-3 text-sm text-gray-700 line-clamp-3">{policy.policy.content}</p>
        {policy.acceptance && (
          <p className="mt-2 text-xs text-gray-500">
            Last signed {new Date(policy.acceptance.acceptedAt).toLocaleString()} as "{policy.acceptance.signature}"
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-3xl rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-wide text-blue-600">Compliance action required</p>
            <h2 className="text-2xl font-bold text-gray-900">Review and accept updated terms</h2>
            <p className="text-sm text-gray-600">
              Please review our Terms of Service and Privacy Policy. Your signature is required to continue onboarding and access
              product features.
            </p>
          </div>
          <div className="rounded-md bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
            {outstandingPolicies.length} outstanding
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {policies.map(renderPolicy)}
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-900">Signature</label>
            <input
              type="text"
              value={signature}
              onChange={event => setSignature(event.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
              placeholder="Type your name to confirm"
              disabled={loading || submitting}
              required
            />
          </div>

          {(formError || error) && <p className="text-sm text-red-600">{formError || error}</p>}

          <div className="flex items-center justify-end gap-3">
            <p className="text-xs text-gray-500">Your acceptance will be timestamped and stored for compliance evidence.</p>
            <button
              type="submit"
              disabled={loading || submitting || outstandingPolicies.length === 0}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitting ? 'Saving...' : 'Accept and continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
