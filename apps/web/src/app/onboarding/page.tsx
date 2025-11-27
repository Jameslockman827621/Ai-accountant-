'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import OnboardingWizardEnhanced from '@/components/OnboardingWizardEnhanced';
import { useOnboarding, type OnboardingStep, type OnboardingEventType } from '@/hooks/useOnboarding';
import { useLegalAgreements } from '@/hooks/useLegalAgreements';
import { TermsAcceptanceModal } from '@/components/TermsAcceptanceModal';

export default function OnboardingPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Get auth token from localStorage (matching the rest of the app)
    const authToken = localStorage.getItem('auth_token') || localStorage.getItem('authToken');
    if (!authToken) {
      // Redirect to login if not authenticated
      router.push('/');
      return;
    }
    setToken(authToken);
    setIsInitialized(true);
  }, [router]);

  const { progress, isLoading, isSubmitting, completeStep, recordEvent, getStepData } = useOnboarding(token);
  const legalAgreements = useLegalAgreements(token);

  const handleStepComplete = async (step: OnboardingStep, stepData?: Record<string, unknown>) => {
    try {
      await completeStep(step, stepData);
      
      // Track completion event
      await recordEvent('step_completed', step, {
        stepData: stepData || {},
        timestamp: new Date().toISOString(),
      });

      // If onboarding is complete, redirect to dashboard
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
  };

  const handleClose = async () => {
    await recordEvent('wizard_closed', undefined, {
      completed: false,
      timestamp: new Date().toISOString(),
    });
    router.push('/');
  };

  const handleTrackEvent = async (
    eventType: OnboardingEventType,
    stepName?: OnboardingStep,
    metadata?: Record<string, unknown>
  ) => {
    await recordEvent(eventType, stepName, metadata);
  };

  // Show loading state while initializing
  if (!isInitialized || isLoading || !progress || (token && legalAgreements.loading && !legalAgreements.isCompliant)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
          <p className="text-gray-600">Loading onboarding...</p>
        </div>
      </div>
    );
  }

  // Track wizard opened event
  useEffect(() => {
    if (token && progress) {
      recordEvent('wizard_opened', undefined, {
        currentStep: progress.currentStep,
        progress: progress.progress,
      });
    }
  }, [token, progress, recordEvent]);

  return (
    <div className="relative min-h-screen bg-gray-50">
      {token && progress && !legalAgreements.isCompliant && !legalAgreements.loading && (
        <TermsAcceptanceModal
          policies={legalAgreements.policies}
          outstandingPolicies={legalAgreements.outstandingPolicies}
          onAccept={legalAgreements.acceptOutstanding}
          loading={legalAgreements.loading}
          error={legalAgreements.error}
        />
      )}
      <div className={legalAgreements.isCompliant ? '' : 'pointer-events-none blur-[1px]'}>
        {token && progress && (
          <OnboardingWizardEnhanced
            token={token}
            progress={progress}
            onStepComplete={handleStepComplete}
            onClose={handleClose}
            trackEvent={handleTrackEvent}
            isSubmitting={isSubmitting}
            getStepData={getStepData}
          />
        )}
      </div>
    </div>
  );
}
