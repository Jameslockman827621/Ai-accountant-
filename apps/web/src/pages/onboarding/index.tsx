'use client';

import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import OnboardingWizardEnhanced from '@/components/OnboardingWizardEnhanced';
import { useOnboarding, type OnboardingEventType, type OnboardingStep } from '@/hooks/useOnboarding';
import KYCVerificationPanel from '@/components/KYCVerificationPanel';
import UnifiedConnectionsPanel from '@/components/UnifiedConnectionsPanel';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

type SampleState = 'idle' | 'loading' | 'ready' | 'error';

export default function OnboardingPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [sampleState, setSampleState] = useState<SampleState>('idle');
  const [sampleError, setSampleError] = useState<string | null>(null);

  useEffect(() => {
    const authToken = typeof window !== 'undefined' ? localStorage.getItem('authToken') : null;
    if (!authToken) {
      router.push('/');
      return;
    }
    setToken(authToken);
    setIsInitialized(true);
  }, [router]);

  const { progress, isLoading, isSubmitting, completeStep, recordEvent, getStepData, refresh } = useOnboarding(token);

  const handleStepComplete = useCallback(
    async (step: OnboardingStep, stepData?: Record<string, unknown>) => {
      try {
        await completeStep(step, stepData);

        await recordEvent('step_completed', step, {
          stepData: stepData || {},
          timestamp: new Date().toISOString(),
        });

        if (step === 'complete') {
          await recordEvent('wizard_closed', undefined, {
            completed: true,
            timestamp: new Date().toISOString(),
          });
          router.push('/');
        }
      } catch (error) {
        console.error('Failed to complete step', error);
        throw error;
      }
    },
    [completeStep, recordEvent, router]
  );

  const handleClose = useCallback(async () => {
    await recordEvent('wizard_closed', undefined, {
      completed: false,
      timestamp: new Date().toISOString(),
    });
    router.push('/');
  }, [recordEvent, router]);

  const handleTrackEvent = useCallback(
    async (eventType: OnboardingEventType, stepName?: OnboardingStep, metadata?: Record<string, unknown>) => {
      await recordEvent(eventType, stepName, metadata);
    },
    [recordEvent]
  );

  const handleSampleCompany = useCallback(async () => {
    if (!token) return;
    setSampleState('loading');
    setSampleError(null);
    try {
      const response = await fetch(`${API_BASE}/api/onboarding/sample-data`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Unable to load sample company data');
      }

      setSampleState('ready');
      await refresh();
    } catch (error) {
      console.error('Failed to load sample company data', error);
      setSampleError(error instanceof Error ? error.message : 'Unable to load sample data');
      setSampleState('error');
    }
  }, [refresh, token]);

  useEffect(() => {
    if (token && progress) {
      recordEvent('wizard_opened', undefined, {
        currentStep: progress.currentStep,
        progress: progress.progress,
      });
    }
  }, [token, progress, recordEvent]);

  if (!isInitialized || isLoading || !progress) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent" />
          <p className="text-gray-600">Loading onboarding...</p>
        </div>
      </div>
    );
  }

  const businessProfile = progress.completedSteps.includes('business_profile') ? 'captured' : 'pending';

  return (
    <>
      <Head>
        <title>Onboarding | AI Accountant</title>
      </Head>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="mx-auto max-w-6xl px-4 space-y-6">
          <header className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-wide text-blue-600">Guided onboarding</p>
            <h1 className="text-3xl font-bold text-gray-900">Create your account, verify compliance, and connect bank feeds</h1>
            <p className="text-gray-600">
              Work through the tailored wizard, complete KYC/KYB checks with our compliance service, and link bank feeds to start
              reconciling transactions.
            </p>
          </header>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <OnboardingWizardEnhanced
                token={token}
                progress={progress}
                onStepComplete={handleStepComplete}
                onClose={handleClose}
                trackEvent={handleTrackEvent}
                isSubmitting={isSubmitting}
                getStepData={getStepData}
                onTrySampleCompany={handleSampleCompany}
                sampleState={sampleState}
                sampleError={sampleError}
              />
            </div>

            <div className="space-y-4">
              <KYCVerificationPanel token={token} variant="onboarding" />
              <div className="rounded-2xl bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Bank feed setup</h3>
                    <p className="text-sm text-gray-500">Connect accounts to start automatic reconciliation.</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                    {businessProfile === 'captured' ? 'Ready' : 'Collecting profile'}
                  </span>
                </div>
                <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-600">
                  Our bank-feed service will surface eligible providers based on your profile. Linking an account now will prefill
                  transactions for the wizard’s historical import step.
                </div>
                <div className="mt-4">
                  <UnifiedConnectionsPanel
                    token={token}
                    variant="onboarding"
                    jurisdiction={undefined}
                    entityType={undefined}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
