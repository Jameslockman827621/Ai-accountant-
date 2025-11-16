'use client';

import { useState, useCallback } from 'react';

interface KYCVerification {
  id: string;
  status: string;
  verificationType: string;
  provider?: string;
  requiresManualReview: boolean;
  expiresAt?: Date;
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export function useKYC(token: string | null) {
  const [verifications, setVerifications] = useState<KYCVerification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVerifications = useCallback(async () => {
    if (!token) {
      setVerifications([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/kyc`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load verifications');
      }

      const data = await response.json();
      setVerifications(data.verifications || []);
    } catch (err) {
      console.error('Failed to fetch KYC verifications', err);
      setError('Unable to load verifications');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  const initiateVerification = useCallback(
    async (config: {
      verificationType: string;
      provider?: string;
      documentType?: string;
      documentReferences?: string[];
    }) => {
      if (!token) {
        throw new Error('Missing authentication token');
      }

      const response = await fetch(`${API_BASE}/api/kyc/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        throw new Error('Failed to initiate verification');
      }

      const data = await response.json();
      await fetchVerifications();
      return data.verificationId;
    },
    [token, fetchVerifications]
  );

  const getVerification = useCallback(
    async (verificationId: string) => {
      if (!token) {
        throw new Error('Missing authentication token');
      }

      const response = await fetch(`${API_BASE}/api/kyc/verify/${verificationId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to get verification');
      }

      const data = await response.json();
      return data.verification;
    },
    [token]
  );

  return {
    verifications,
    isLoading,
    error,
    refresh: fetchVerifications,
    initiateVerification,
    getVerification,
  };
}
