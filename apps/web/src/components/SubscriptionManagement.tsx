import React, { useState, useEffect, useMemo, useCallback } from 'react';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

type Tier = 'freelancer' | 'sme' | 'accountant' | 'enterprise';
type SubscriptionStatus = 'active' | 'cancelled' | 'expired';

interface Subscription {
  tier: Tier;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

interface Usage {
  period: string;
  documentsProcessed: number;
  ocrRequests: number;
  llmQueries: number;
  filingsSubmitted: number;
  storageUsed: number;
}

interface SubscriptionManagementProps {
  token: string;
}

export default function SubscriptionManagement({ token }: SubscriptionManagementProps) {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const tierLimits: Record<Tier, { documents: number; storage: number }> = {
    freelancer: { documents: 100, storage: 1_000_000_000 },
    sme: { documents: 500, storage: 5_000_000_000 },
    accountant: { documents: 2000, storage: 20_000_000_000 },
    enterprise: { documents: -1, storage: -1 },
  };

  const fetchData = useCallback(async (signal?: AbortSignal) => {
    try {
      setLoading(true);
      setError(null);

      const [subscriptionRes, usageRes] = await Promise.all([
        fetch(`${API_BASE}/api/billing/subscription`, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        }),
        fetch(`${API_BASE}/api/billing/usage`, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        }),
      ]);

      if (!subscriptionRes.ok) {
        throw new Error(`Subscription request failed (${subscriptionRes.status})`);
      }
      if (!usageRes.ok) {
        throw new Error(`Usage request failed (${usageRes.status})`);
      }

      const subscriptionJson = await subscriptionRes.json() as { subscription: Record<string, any> };
      const usageJson = await usageRes.json() as { usage: Record<string, any> };

      setSubscription({
        tier: (subscriptionJson.subscription.subscription_tier ??
          subscriptionJson.subscription.tier ??
          'freelancer') as Tier,
        status: (subscriptionJson.subscription.status ?? 'active') as SubscriptionStatus,
        currentPeriodStart:
          subscriptionJson.subscription.current_period_start ??
          subscriptionJson.subscription.currentPeriodStart,
        currentPeriodEnd:
          subscriptionJson.subscription.current_period_end ??
          subscriptionJson.subscription.currentPeriodEnd,
        cancelAtPeriodEnd:
          subscriptionJson.subscription.cancel_at_period_end ??
          subscriptionJson.subscription.cancelAtPeriodEnd ??
          false,
      });
      setUsage({
        period: usageJson.usage.period,
        documentsProcessed:
          usageJson.usage.documentsProcessed ?? usageJson.usage.documents_processed ?? 0,
        ocrRequests: usageJson.usage.ocrRequests ?? usageJson.usage.ocr_requests ?? 0,
        llmQueries: usageJson.usage.llmQueries ?? usageJson.usage.llm_queries ?? 0,
        filingsSubmitted: usageJson.usage.filingsSubmitted ?? usageJson.usage.filings_submitted ?? 0,
        storageUsed: usageJson.usage.storageUsed ?? usageJson.usage.storage_used ?? 0,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to load subscription data');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    return () => controller.abort();
  }, [fetchData]);
  const limits = useMemo(() => {
    if (!subscription) return { documents: 0, storage: 0 };
    return tierLimits[subscription.tier];
  }, [subscription]);

  const handleUpgrade = async (tier: Tier) => {
    try {
      setActionLoading(true);
      setError(null);
      setActionMessage(null);
      await fetch(`${API_BASE}/api/billing/subscription`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tier }),
      }).then(async response => {
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || `Upgrade failed (${response.status})`);
        }
      });
      setActionMessage(`Subscription updated to ${tier}`);
      await fetchData();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to update subscription');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async (cancelAtPeriodEnd: boolean) => {
    try {
      setActionLoading(true);
      setError(null);
      setActionMessage(null);
      await fetch(`${API_BASE}/api/billing/subscription/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cancelAtPeriodEnd }),
      }).then(async response => {
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || `Cancel request failed (${response.status})`);
        }
      });
      setActionMessage(cancelAtPeriodEnd ? 'Subscription will cancel at period end' : 'Subscription reactivated');
      await fetchData();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to update cancellation preference');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-2">Subscription Management</h2>
        <p className="text-sm text-gray-500">Loading subscription details…</p>
      </section>
    );
  }

  if (!subscription) {
    return (
      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-2">Subscription Management</h2>
        <p className="text-sm text-gray-500">No subscription found for this tenant.</p>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-lg shadow p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Subscription Management</h2>
          <p className="text-sm text-gray-500">Manage billing plan, cancellations, and usage.</p>
        </div>
        {actionLoading && <span className="text-xs text-gray-500">Updating…</span>}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      {actionMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded text-sm">
          {actionMessage}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Current Plan</span>
          <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded font-semibold capitalize">
            {subscription.tier}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Status</span>
          <span
            className={`px-3 py-1 rounded font-semibold ${
              subscription.status === 'active'
                ? 'bg-green-100 text-green-800'
                : subscription.status === 'cancelled'
                ? 'bg-red-100 text-red-800'
                : 'bg-gray-100 text-gray-800'
            }`}
          >
            {subscription.status}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600">Billing Period</span>
          <span className="text-sm">
            {new Date(subscription.currentPeriodStart).toLocaleDateString('en-GB')} –{' '}
            {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-GB')}
          </span>
        </div>
        {subscription.cancelAtPeriodEnd && (
          <p className="text-xs text-amber-600">
            This subscription will cancel at the end of the current period.
          </p>
        )}
      </div>

      {usage && (
        <div>
          <h3 className="font-semibold mb-3">Usage ({usage.period})</h3>
          <div className="space-y-4">
            <UsageBar
              label="Documents processed"
              value={usage.documents_processed}
              limit={limits.documents}
            />
            <UsageBar
              label="Storage used"
              value={usage.storage_used}
              limit={limits.storage}
              formatter={(value) => `${(value / 1_000_000).toFixed(1)} MB`}
            />
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UsageStat label="OCR requests" value={usage.ocrRequests} />
          <UsageStat label="LLM queries" value={usage.llmQueries} />
          <UsageStat label="Filings submitted" value={usage.filingsSubmitted} />
          <UsageStat label="Documents processed" value={usage.documentsProcessed} />
        </div>
        <div className="flex flex-wrap gap-2">
          {(['freelancer', 'sme', 'accountant', 'enterprise'] as Tier[]).map((tier) => (
            <button
              key={tier}
              onClick={() => handleUpgrade(tier)}
              disabled={subscription.tier === tier || actionLoading}
              className={`px-3 py-1 rounded border ${
                subscription.tier === tier
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              } disabled:opacity-50`}
            >
              {tier}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {subscription.status === 'active' && !subscription.cancelAtPeriodEnd && (
            <button
              onClick={() => handleCancel(true)}
              className="px-4 py-2 border border-red-300 text-red-700 rounded hover:bg-red-50"
            >
              Cancel at period end
            </button>
          )}
          {subscription.cancelAtPeriodEnd && (
            <button
              onClick={() => handleCancel(false)}
              className="px-4 py-2 border border-green-300 text-green-700 rounded hover:bg-green-50"
            >
              Keep subscription
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function UsageBar({
  label,
  value,
  limit,
  formatter = (val: number) => val.toString(),
}: {
  label: string;
  value: number;
  limit: number;
  formatter?: (val: number) => string;
}) {
  const percent = limit > 0 ? Math.min((value / limit) * 100, 100) : null;
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-sm text-gray-600">{label}</span>
        <span className="text-sm font-medium">
          {formatter(value)}
          {limit > 0 ? ` / ${formatter(limit)}` : ''}
        </span>
      </div>
      {percent != null && (
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

function UsageStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border rounded-lg p-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-lg font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}
