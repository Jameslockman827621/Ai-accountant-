'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLegalAgreements } from '@/hooks/useLegalAgreements';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

interface PrivacySettingsResponse {
  defaultRetentionDays: number;
  erasureGracePeriodDays: number;
  ccpaOptOut: boolean;
  autoDeleteEnabled: boolean;
}

interface RetentionAction {
  tableName: string;
  policyName: string;
  rowsAffected: number;
}

export default function PrivacySettingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [settings, setSettings] = useState<PrivacySettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retentionActions, setRetentionActions] = useState<RetentionAction[]>([]);
  const [erasureStatus, setErasureStatus] = useState<string | null>(null);

  const legalAgreements = useLegalAgreements(token);

  useEffect(() => {
    const storedToken = localStorage.getItem('auth_token') || localStorage.getItem('authToken');
    setToken(storedToken);
  }, []);

  const fetchSettings = async (authToken: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/compliance/privacy/settings`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load privacy settings');
      }

      const data = (await response.json()) as { settings: PrivacySettingsResponse };
      setSettings(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load privacy settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      void fetchSettings(token);
    }
  }, [token]);

  const handleSave = async () => {
    if (!token || !settings) return;

    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/compliance/privacy/settings`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Unable to update settings');
      }

      const data = (await response.json()) as { settings: PrivacySettingsResponse };
      setSettings(data.settings);
      setMessage('Privacy preferences updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleRetentionRun = async () => {
    if (!token) return;
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/compliance/privacy/run-retention`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Unable to execute retention policies');
      }
      const data = (await response.json()) as { actions: RetentionAction[] };
      setRetentionActions(data.actions || []);
      setMessage('Data retention policies enforced');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to enforce retention policies');
    }
  };

  const handleErasureRequest = async () => {
    if (!token) return;
    setErasureStatus(null);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/compliance/privacy/erasure`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Unable to submit erasure request');
      }
      const data = (await response.json()) as { requestId: string };
      setErasureStatus(`Erasure request submitted (${data.requestId})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit erasure request');
    }
  };

  const outstandingPoliciesLabel = useMemo(() => {
    if (legalAgreements.outstandingPolicies.length === 0) {
      return 'All legal policies are accepted.';
    }
    return `${legalAgreements.outstandingPolicies.length} policy updates need your signature.`;
  }, [legalAgreements.outstandingPolicies.length]);

  if (!token) {
    return <div className="p-6">Please sign in to manage privacy settings.</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-wide text-blue-600">Privacy & Compliance</p>
            <h1 className="text-2xl font-bold text-gray-900">Data protection controls</h1>
            <p className="text-sm text-gray-600">Configure retention, erasure workflows, and verify legal acknowledgements.</p>
          </div>
          <div className="rounded-md bg-white px-3 py-2 text-sm shadow">
            {legalAgreements.loading ? 'Checking policies…' : outstandingPoliciesLabel}
          </div>
        </header>

        {(message || error || erasureStatus) && (
          <div
            className={`rounded-md border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}
          >
            {error || erasureStatus || message}
          </div>
        )}

        <section className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-semibold text-gray-900">Retention & data minimization</h2>
          <p className="text-sm text-gray-600">Apply GDPR/CCPA aligned retention defaults across customer data stores.</p>

          {loading || !settings ? (
            <p className="mt-4 text-gray-500">Loading settings…</p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="font-medium text-gray-900">Default retention (days)</span>
                <input
                  type="number"
                  min={30}
                  value={settings.defaultRetentionDays}
                  onChange={event => setSettings({ ...settings, defaultRetentionDays: Number(event.target.value) })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-gray-900">Erasure grace period (days)</span>
                <input
                  type="number"
                  min={1}
                  value={settings.erasureGracePeriodDays}
                  onChange={event => setSettings({ ...settings, erasureGracePeriodDays: Number(event.target.value) })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <input
                  type="checkbox"
                  checked={settings.ccpaOptOut}
                  onChange={event => setSettings({ ...settings, ccpaOptOut: event.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Respect CCPA Do Not Sell preferences
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-900">
                <input
                  type="checkbox"
                  checked={settings.autoDeleteEnabled}
                  onChange={event => setSettings({ ...settings, autoDeleteEnabled: event.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Auto-delete records that exceed retention windows
              </label>
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              onClick={handleRetentionRun}
              disabled={saving}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Run retention job now
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:bg-blue-300"
            >
              {saving ? 'Saving…' : 'Save preferences'}
            </button>
          </div>

          {retentionActions.length > 0 && (
            <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 p-3 text-sm text-blue-900">
              <p className="font-semibold">Recent enforcement</p>
              <ul className="mt-2 space-y-1">
                {retentionActions.map(action => (
                  <li key={`${action.tableName}-${action.policyName}`}>
                    {action.policyName}: {action.rowsAffected} rows affected in {action.tableName}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="rounded-lg bg-white p-6 shadow">
          <h2 className="text-lg font-semibold text-gray-900">Erasure and subject rights</h2>
          <p className="text-sm text-gray-600">Submit or process erasure requests without leaving the product.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={handleErasureRequest}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Request my data erasure
            </button>
            <button
              onClick={() => legalAgreements.refresh()}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Refresh acknowledgements
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {legalAgreements.policies.map(policy => (
              <div key={policy.policy.policyType} className="rounded-md border border-gray-200 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-gray-900">{policy.policy.title}</p>
                  <span className={`rounded-full px-2 py-1 text-xs ${policy.accepted ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                    {policy.accepted ? 'Current version accepted' : 'Signature required'}
                  </span>
                </div>
                <p className="text-xs text-gray-500">Version {policy.policy.version}</p>
                {policy.acceptance && (
                  <p className="mt-1 text-xs text-gray-600">
                    Signed {new Date(policy.acceptance.acceptedAt).toLocaleString()} as "{policy.acceptance.signature}"
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
