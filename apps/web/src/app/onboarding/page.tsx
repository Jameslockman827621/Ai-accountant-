'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import OnboardingWizardEnhanced from '@/components/OnboardingWizardEnhanced';
import { useOnboarding, type OnboardingStep, type OnboardingEventType } from '@/hooks/useOnboarding';

export default function OnboardingPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Get auth token from localStorage (matching the rest of the app)
    const authToken = localStorage.getItem('authToken');
    if (!authToken) {
      // Redirect to login if not authenticated
      router.push('/');
      return;
    }
    setToken(authToken);
    setIsInitialized(true);
  }, [router]);

  const { progress, isLoading, isSubmitting, completeStep, recordEvent, getStepData } = useOnboarding(token);

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
  if (!isInitialized || isLoading || !progress) {
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
    <div className="min-h-screen bg-gray-50">
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
  );
}
