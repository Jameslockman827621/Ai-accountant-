'use client';

import { useCallback, useEffect, useState } from 'react';
import { useKYC } from '@/hooks/useKYC';

interface KYCVerificationPanelProps {
  token: string;
  variant?: 'onboarding' | 'dashboard';
}

interface KYCSession {
  sessionId: string;
  verificationId: string;
  providerHandoffUrl?: string;
  status: string;
}

export default function KYCVerificationPanel({ token, variant = 'dashboard' }: KYCVerificationPanelProps) {
  const { verifications, isLoading, error, refresh, createSession, getVerification } = useKYC(token);
  const [activeSession, setActiveSession] = useState<KYCSession | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<'persona' | 'onfido' | ''>('');
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll for verification status updates
  useEffect(() => {
    if (activeSession && activeSession.status === 'pending') {
      const interval = setInterval(async () => {
        try {
          const verification = await getVerification(activeSession.verificationId);
          if (verification && verification.status !== 'pending') {
            setActiveSession(prev => prev ? { ...prev, status: verification.status } : null);
            refresh();
            if (interval) clearInterval(interval);
          }
        } catch (err) {
          console.error('Failed to poll verification status', err);
        }
      }, 3000); // Poll every 3 seconds

      setPollingInterval(interval);
      return () => {
        if (interval) clearInterval(interval);
      };
    } else if (pollingInterval) {
      clearInterval(pollingInterval);
      setPollingInterval(null);
    }
    return undefined;
  }, [activeSession, getVerification, refresh]);

  const handleStartVerification = useCallback(async () => {
    if (!selectedProvider) {
      return;
    }

    setIsCreatingSession(true);
    try {
      const session = await createSession({
        verificationType: 'identity',
        provider: selectedProvider,
        metadata: {},
      });
      setActiveSession(session);
    } catch (err) {
      console.error('Failed to create KYC session', err);
    } finally {
      setIsCreatingSession(false);
    }
  }, [selectedProvider, createSession]);

  const handleRetry = useCallback(() => {
    setActiveSession(null);
    setSelectedProvider('');
  }, []);

  const latestVerification = verifications.length > 0 ? verifications[0] : null;
  const status = activeSession?.status || latestVerification?.status || 'none';

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'rejected':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'in_progress':
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'requires_review':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusMessage = (status: string) => {
    switch (status) {
      case 'approved':
        return 'Your verification has been approved.';
      case 'rejected':
        return 'Your verification was rejected. Please review the requirements and try again.';
      case 'in_progress':
        return 'Verification is in progress. This may take a few minutes.';
      case 'pending':
        return 'Verification is pending. Please complete the verification process.';
      case 'requires_review':
        return 'Your verification requires manual review. We will notify you once it is complete.';
      default:
        return 'No verification started yet.';
    }
  };

  const variantClasses = variant === 'onboarding' ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-white';

  return (
    <div className={`rounded-2xl border ${variantClasses} p-6 shadow-sm space-y-4`}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Identity Verification</h3>
          <p className="text-sm text-gray-500">
            Complete KYC verification to unlock all platform features.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading && !latestVerification && (
        <p className="text-sm text-gray-500">Loading verification status…</p>
      )}

      {status !== 'none' && (
        <div className={`rounded-lg border ${getStatusColor(status)} p-4 space-y-3`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">Verification Status</p>
              <p className="text-sm opacity-90">{getStatusMessage(status)}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${getStatusColor(status)}`}>
              {status.replace('_', ' ').toUpperCase()}
            </span>
          </div>

          {activeSession?.providerHandoffUrl && status === 'pending' && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Complete your verification:</p>
              <a
                href={activeSession.providerHandoffUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Open Verification Portal
              </a>
            </div>
          )}

          {status === 'rejected' && (
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Retry Verification
            </button>
          )}

          {status === 'requires_review' && (
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
              <p className="font-medium text-orange-900">Manual Review Required</p>
              <p className="text-orange-700 mt-1">
                Our compliance team is reviewing your verification. This typically takes 1-2 business days.
              </p>
            </div>
          )}
        </div>
      )}

      {status === 'none' && !activeSession && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Verification Provider
            </label>
            <div className="space-y-2">
              <label className="flex items-center space-x-3 rounded border border-gray-200 p-3 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="provider"
                  value="persona"
                  checked={selectedProvider === 'persona'}
                  onChange={e => setSelectedProvider(e.target.value as 'persona')}
                  className="h-4 w-4 text-blue-600"
                />
                <div>
                  <p className="font-medium text-gray-900">Persona</p>
                  <p className="text-sm text-gray-500">Fast, secure identity verification</p>
                </div>
              </label>
              <label className="flex items-center space-x-3 rounded border border-gray-200 p-3 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="provider"
                  value="onfido"
                  checked={selectedProvider === 'onfido'}
                  onChange={e => setSelectedProvider(e.target.value as 'onfido')}
                  className="h-4 w-4 text-blue-600"
                />
                <div>
                  <p className="font-medium text-gray-900">Onfido</p>
                  <p className="text-sm text-gray-500">Comprehensive document verification</p>
                </div>
              </label>
            </div>
          </div>

          <button
            type="button"
            onClick={handleStartVerification}
            disabled={!selectedProvider || isCreatingSession}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isCreatingSession ? 'Starting Verification…' : 'Start Verification'}
          </button>
        </div>
      )}

      {/* Verification Timeline */}
      {latestVerification && (
        <div className="border-t pt-4 space-y-2">
          <p className="text-sm font-medium text-gray-700">Verification Timeline</p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center space-x-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-gray-600">Verification created</span>
            </div>
            {status === 'approved' && (
              <div className="flex items-center space-x-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-gray-600">Verification approved</span>
              </div>
            )}
            {status === 'rejected' && (
              <div className="flex items-center space-x-2">
                <div className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-gray-600">Verification rejected</span>
              </div>
            )}
            {status === 'requires_review' && (
              <div className="flex items-center space-x-2">
                <div className="h-2 w-2 rounded-full bg-yellow-500" />
                <span className="text-gray-600">Awaiting manual review</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
