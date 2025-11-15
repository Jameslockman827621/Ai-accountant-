'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type OnboardingStep =
  | 'welcome'
  | 'business_profile'
  | 'tax_scope'
  | 'chart_of_accounts'
  | 'bank_connection'
  | 'historical_import'
  | 'filing_preferences'
  | 'first_document'
  | 'complete';

export interface OnboardingProgress {
  tenantId: string;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  progress: number;
}

export type OnboardingEventType =
  | 'wizard_opened'
  | 'wizard_closed'
  | 'step_viewed'
  | 'step_completed'
  | 'step_skipped'
  | 'journey_reset';

type StepData = Record<string, unknown>;

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export function useOnboarding(token: string | null) {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stepDataCache = useRef<Map<OnboardingStep, StepData | null>>(new Map());

  const authenticatedHeaders = useCallback((): HeadersInit | null => {
    if (!token) {
      return null;
    }

    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }, [token]);

  const fetchProgress = useCallback(async () => {
    if (!token) {
      setProgress(null);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/onboarding/progress`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to load onboarding progress');
      }

      const data = await response.json() as { progress: OnboardingProgress };
      setProgress(data.progress);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch onboarding progress', err);
      setError('Unable to load onboarding progress right now.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchProgress();
  }, [fetchProgress]);

  const completeStep = useCallback(
    async (stepName: OnboardingStep, stepData?: StepData) => {
      const headers = authenticatedHeaders();
      if (!headers) {
        throw new Error('Missing authentication token');
      }

      setIsSubmitting(true);
      try {
        const response = await fetch(`${API_BASE}/api/onboarding/steps/${stepName}/complete`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ stepData }),
        });

        if (!response.ok) {
          throw new Error('Failed to complete onboarding step');
        }

        // Invalidate cache for this step so fresh data can be reloaded later if needed
        stepDataCache.current.delete(stepName);

        await fetchProgress();
      } catch (err) {
        console.error('Failed to complete onboarding step', err);
        setError('Unable to save this onboarding step right now.');
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [authenticatedHeaders, fetchProgress]
  );

  const recordEvent = useCallback(
    async (eventType: OnboardingEventType, stepName?: OnboardingStep, metadata?: StepData) => {
      const headers = authenticatedHeaders();
      if (!headers) {
        return;
      }

      try {
        await fetch(`${API_BASE}/api/onboarding/events`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            eventType,
            stepName,
            metadata,
          }),
        });
      } catch (err) {
        console.warn('Failed to record onboarding telemetry event', err);
      }
    },
    [authenticatedHeaders]
  );

  const getStepData = useCallback(
    async (stepName: OnboardingStep): Promise<StepData | null> => {
      if (stepDataCache.current.has(stepName)) {
        return stepDataCache.current.get(stepName) ?? null;
      }

      const headers = authenticatedHeaders();
      if (!headers) {
        return null;
      }

      try {
        const response = await fetch(`${API_BASE}/api/onboarding/steps/${stepName}`, {
          headers,
        });

        if (!response.ok) {
          throw new Error('Failed to load onboarding step data');
        }

        const data = await response.json() as { stepData: StepData | null };
        stepDataCache.current.set(stepName, data.stepData ?? null);
        return data.stepData ?? null;
      } catch (err) {
        console.error('Failed to fetch onboarding step data', err);
        return null;
      }
    },
    [authenticatedHeaders]
  );

  return {
    progress,
    isLoading,
    isSubmitting,
    error,
    refresh: fetchProgress,
    completeStep,
    recordEvent,
    getStepData,
  };
}
