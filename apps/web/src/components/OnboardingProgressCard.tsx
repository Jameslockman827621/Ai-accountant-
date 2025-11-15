'use client';

import type { OnboardingProgress } from '@/hooks/useOnboarding';

interface OnboardingProgressCardProps {
  progress: OnboardingProgress;
  onResume: () => void;
  isLoading: boolean;
  error?: string | null;
}

const STEP_LABELS: Record<string, string> = {
  welcome: 'Welcome',
  business_profile: 'Business profile',
  tax_scope: 'Tax scope',
  chart_of_accounts: 'Chart mapping',
  bank_connection: 'Bank linking',
  historical_import: 'Historical import',
  filing_preferences: 'Filing preferences',
  first_document: 'First document',
  complete: 'Complete',
};

export default function OnboardingProgressCard({
  progress,
  onResume,
  isLoading,
  error,
}: OnboardingProgressCardProps) {
  const totalSteps = Object.keys(STEP_LABELS).length;
  const completedCount = progress.completedSteps.length;
  const nextStepLabel = STEP_LABELS[progress.currentStep] || 'Next step';

  return (
    <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-blue-700">Guided onboarding</p>
          <h3 className="text-2xl font-semibold text-gray-900">
            {progress.progress}% complete
          </h3>
          <p className="text-sm text-gray-600">
            {completedCount} of {totalSteps} steps finished · Current: {nextStepLabel}
          </p>
          {error && (
            <p className="mt-2 text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onResume}
          disabled={isLoading}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? 'Updating…' : progress.currentStep === 'complete' ? 'View summary' : 'Resume setup'}
        </button>
      </div>
      <div className="mt-4 h-2 rounded-full bg-blue-100">
        <div
          className="h-2 rounded-full bg-blue-600 transition-all"
          style={{ width: `${progress.progress}%` }}
        />
      </div>
    </div>
  );
}
