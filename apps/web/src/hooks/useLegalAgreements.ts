'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export type PolicyType = 'terms_of_service' | 'privacy_policy';

export interface PolicyDetails {
  id: string;
  policyType: PolicyType;
  version: string;
  title: string;
  content: string;
  effectiveAt: string;
}

export interface PolicyAcceptance {
  policyType: PolicyType;
  version: string;
  signature: string;
  acceptedAt: string;
  policyVersionId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

export interface PolicyStatus {
  policy: PolicyDetails;
  acceptance?: PolicyAcceptance;
  accepted: boolean;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export function useLegalAgreements(token?: string | null) {
  const [policies, setPolicies] = useState<PolicyStatus[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPolicies = useCallback(async () => {
    if (!token) {
      setPolicies([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/compliance/legal/policies`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Unable to load policy status');
      }

      const data = (await response.json()) as { policies?: PolicyStatus[] };
      setPolicies(data.policies || []);
    } catch (err) {
      console.error('Failed to load policies', err);
      setError(err instanceof Error ? err.message : 'Unable to load policy status');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchPolicies();
  }, [fetchPolicies]);

  const outstandingPolicies = useMemo(
    () => policies.filter(policy => !policy.accepted),
    [policies]
  );

  const acceptPolicy = useCallback(
    async (policyType: PolicyType, signature: string) => {
      if (!token) {
        throw new Error('Missing authentication');
      }
      const response = await fetch(`${API_BASE}/api/compliance/legal/accept`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ policyType, signature }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Unable to record acceptance');
      }

      await fetchPolicies();
    },
    [fetchPolicies, token]
  );

  const acceptOutstanding = useCallback(
    async (signature: string) => {
      for (const status of outstandingPolicies) {
        await acceptPolicy(status.policy.policyType, signature);
      }
    },
    [acceptPolicy, outstandingPolicies]
  );

  return {
    policies,
    outstandingPolicies,
    loading,
    error,
    refresh: fetchPolicies,
    acceptPolicy,
    acceptOutstanding,
    isCompliant: outstandingPolicies.length === 0,
  };
}
