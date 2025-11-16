'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DocumentUpload from './DocumentUpload';
import { DocumentType } from '@ai-accountant/shared-types';
import UnifiedConnectionsPanel from './UnifiedConnectionsPanel';
import KYCVerificationPanel from './KYCVerificationPanel';
import type {
  OnboardingEventType,
  OnboardingProgress,
  OnboardingStep,
} from '@/hooks/useOnboarding';
import { useOnboarding } from '@/hooks/useOnboarding';

interface OnboardingWizardEnhancedProps {
  token: string;
  progress: OnboardingProgress;
  onStepComplete: (step: OnboardingStep, stepData?: Record<string, unknown>) => Promise<void>;
  onClose?: () => void;
  trackEvent?: (eventType: OnboardingEventType, stepName?: OnboardingStep, metadata?: Record<string, unknown>) => Promise<void>;
  isSubmitting: boolean;
  getStepData: (step: OnboardingStep) => Promise<Record<string, unknown> | null>;
}

interface OnboardingSchema {
  jurisdiction: string;
  entityType?: string;
  industry?: string;
  steps: Array<{
    stepName: string;
    title: string;
    description: string;
    enabled: boolean;
    required: boolean;
    fields: Array<{
      name: string;
      label: string;
      type: string;
      required: boolean;
      placeholder?: string;
      options?: Array<{ value: string; label: string }>;
      regex?: string;
      minLength?: number;
      maxLength?: number;
      min?: number;
      max?: number;
      defaultValue?: string | number | boolean;
      helpText?: string;
    }>;
    validationRules: Array<{
      field: string;
      type: string;
      message: string;
    }>;
    order: number;
  }>;
  localization: {
    currencyCode: string;
    currencySymbol: string;
    dateFormat: string;
    timezone: string;
    numberFormat: {
      decimalSeparator: string;
      thousandSeparator: string;
    };
  };
  enabledSteps: string[];
  requiredSteps: string[];
}

export default function OnboardingWizardEnhanced({
  token,
  progress,
  onStepComplete,
  onClose,
  trackEvent,
  isSubmitting,
  getStepData,
}: OnboardingWizardEnhancedProps) {
  const { getSchema, saveStepData } = useOnboarding(token);
  const [schema, setSchema] = useState<OnboardingSchema | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(true);
  const [stepData, setStepData] = useState<Record<string, Record<string, unknown>>>({});
  const [stepErrors, setStepErrors] = useState<Record<string, string[]>>({});
  const [hydratingStep, setHydratingStep] = useState(false);
  const hydratedSteps = useRef<Set<OnboardingStep>>(new Set());
  const lastTrackedStep = useRef<OnboardingStep | null>(null);

  // Determine jurisdiction from business profile or default to GB
  const jurisdiction = useMemo(() => {
    const businessProfile = stepData['business_profile'];
    return (businessProfile?.country as string) || 'GB';
  }, [stepData]);

  // Load schema when jurisdiction is available
  useEffect(() => {
    const loadSchema = async () => {
      if (!jurisdiction) return;
      
      setLoadingSchema(true);
      try {
        const businessProfile = stepData['business_profile'];
        const schemaData = await getSchema(
          jurisdiction,
          businessProfile?.businessType as string | undefined,
          businessProfile?.industry as string | undefined
        );
        if (schemaData) {
          setSchema(schemaData);
        }
      } catch (err) {
        console.error('Failed to load schema', err);
      } finally {
        setLoadingSchema(false);
      }
    };

    void loadSchema();
  }, [jurisdiction, getSchema, stepData]);

  // Get current step definition from schema
  const currentStepDef = useMemo(() => {
    if (!schema) return null;
    return schema.steps.find(s => s.stepName === progress.currentStep);
  }, [schema, progress.currentStep]);

  // Get ordered steps from schema
  const orderedSteps = useMemo(() => {
    if (!schema) return [];
    return [...schema.steps].sort((a, b) => a.order - b.order);
  }, [schema]);

  const activeStepIndex = useMemo(() => {
    if (!schema) return 0;
    const idx = orderedSteps.findIndex(step => step.stepName === progress.currentStep);
    return idx === -1 ? 0 : idx;
  }, [orderedSteps, progress.currentStep, schema]);

  const totalSteps = orderedSteps.length;
  const completionPercent = useMemo(() => {
    if (!schema) return 0;
    return Math.min(
      100,
      Math.round(((activeStepIndex + (progress.completedSteps.includes(progress.currentStep) ? 1 : 0)) / totalSteps) * 100)
    );
  }, [activeStepIndex, progress.currentStep, progress.completedSteps, totalSteps, schema]);

  // Track step views
  useEffect(() => {
    if (!trackEvent || lastTrackedStep.current === progress.currentStep) {
      return;
    }
    trackEvent('step_viewed', progress.currentStep, {
      progress: progress.progress,
    });
    lastTrackedStep.current = progress.currentStep;
  }, [progress.currentStep, progress.progress, trackEvent]);

  // Hydrate step data
  useEffect(() => {
    const hydrate = async () => {
      if (hydratedSteps.current.has(progress.currentStep)) {
        return;
      }
      setHydratingStep(true);
      try {
        const serverData = await getStepData(progress.currentStep);
        if (serverData) {
          setStepData(prev => ({
            ...prev,
            [progress.currentStep]: serverData,
          }));
        }
        hydratedSteps.current.add(progress.currentStep);
      } finally {
        setHydratingStep(false);
      }
    };

    void hydrate();
  }, [getStepData, progress.currentStep]);

  // Auto-close on completion
  useEffect(() => {
    if (progress.completedSteps.includes('complete') && onClose) {
      onClose();
    }
  }, [onClose, progress.completedSteps]);

  // Update step data
  const updateStepData = useCallback((fieldName: string, value: unknown) => {
    setStepData(prev => ({
      ...prev,
      [progress.currentStep]: {
        ...prev[progress.currentStep],
        [fieldName]: value,
      },
    }));
    // Clear errors for this field
    setStepErrors(prev => ({
      ...prev,
      [progress.currentStep]: prev[progress.currentStep]?.filter(e => !e.includes(fieldName)) || [],
    }));
  }, [progress.currentStep]);

  // Validate step using schema
  const validateStep = useCallback((): string[] => {
    if (!currentStepDef) return [];
    
    const errors: string[] = [];
    const currentData = stepData[progress.currentStep] || {};

    // Check required fields
    for (const field of currentStepDef.fields) {
      if (field.required) {
        const value = currentData[field.name];
        if (value === undefined || value === null || value === '') {
          errors.push(`${field.label} is required`);
          continue;
        }
      }

      const value = currentData[field.name];
      if (value === undefined || value === null || value === '') {
        continue;
      }

      // Type-specific validation
      if (field.type === 'email' && typeof value === 'string') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
          errors.push(`${field.label} must be a valid email address`);
        }
      }

      if (field.type === 'text' && typeof value === 'string') {
        if (field.minLength && value.length < field.minLength) {
          errors.push(`${field.label} must be at least ${field.minLength} characters`);
        }
        if (field.maxLength && value.length > field.maxLength) {
          errors.push(`${field.label} must be at most ${field.maxLength} characters`);
        }
        if (field.regex && !new RegExp(field.regex).test(value)) {
          errors.push(`${field.label} format is invalid`);
        }
      }

      if (field.type === 'number' && typeof value === 'number') {
        if (field.min !== undefined && value < field.min) {
          errors.push(`${field.label} must be at least ${field.min}`);
        }
        if (field.max !== undefined && value > field.max) {
          errors.push(`${field.label} must be at most ${field.max}`);
        }
      }
    }

    // Check validation rules
    for (const rule of currentStepDef.validationRules) {
      const value = currentData[rule.field];
      if (rule.type === 'required' && (value === undefined || value === null || value === '')) {
        errors.push(rule.message);
      }
    }

    return errors;
  }, [currentStepDef, stepData, progress.currentStep]);

  // Handle submit
  const handleSubmit = useCallback(async () => {
    const errors = validateStep();
    if (errors.length > 0) {
      setStepErrors(prev => ({
        ...prev,
        [progress.currentStep]: errors,
      }));
      return;
    }

    setStepErrors(prev => ({
      ...prev,
      [progress.currentStep]: [],
    }));

    const currentData = stepData[progress.currentStep] || {};

    try {
      // Save as draft first
      if (schema) {
        await saveStepData(
          progress.currentStep,
          currentData,
          schema.jurisdiction,
          schema.entityType,
          schema.industry
        );
      }

      // Complete step
      await onStepComplete(progress.currentStep, currentData);
    } catch (error) {
      setStepErrors(prev => ({
        ...prev,
        [progress.currentStep]: [error instanceof Error ? error.message : 'Unable to complete this step right now.'],
      }));
    }
  }, [validateStep, stepData, progress.currentStep, onStepComplete, saveStepData, schema]);

  // Handle skip
  const handleSkip = useCallback(async () => {
    try {
      await onStepComplete(progress.currentStep, { skipped: true });
    } catch (error) {
      setStepErrors(prev => ({
        ...prev,
        [progress.currentStep]: [error instanceof Error ? error.message : 'Unable to skip this step.'],
      }));
    }
  }, [progress.currentStep, onStepComplete]);

  // Render field based on schema
  const renderField = useCallback((field: OnboardingSchema['steps'][0]['fields'][0]) => {
    const currentData = stepData[progress.currentStep] || {};
    const value = currentData[field.name] ?? field.defaultValue ?? '';

    switch (field.type) {
      case 'text':
      case 'email':
      case 'tel':
        return (
          <div key={field.name}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </label>
            <input
              type={field.type}
              value={String(value)}
              onChange={e => updateStepData(field.name, e.target.value)}
              placeholder={field.placeholder}
              minLength={field.minLength}
              maxLength={field.maxLength}
              className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {field.helpText && <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>}
          </div>
        );

      case 'number':
        return (
          <div key={field.name}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </label>
            <input
              type="number"
              value={Number(value) || ''}
              onChange={e => updateStepData(field.name, e.target.value ? Number(e.target.value) : '')}
              placeholder={field.placeholder}
              min={field.min}
              max={field.max}
              className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {field.helpText && <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>}
          </div>
        );

      case 'select':
        return (
          <div key={field.name}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {field.label} {field.required && <span className="text-red-500">*</span>}
            </label>
            <select
              value={String(value)}
              onChange={e => updateStepData(field.name, e.target.value)}
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {field.options?.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {field.helpText && <p className="mt-1 text-xs text-gray-500">{field.helpText}</p>}
          </div>
        );

      case 'checkbox':
        return (
          <div key={field.name} className="flex items-start space-x-3 rounded border border-gray-200 p-3">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={e => updateStepData(field.name, e.target.checked)}
              className="mt-1"
            />
            <div>
              <label className="font-medium text-gray-800">
                {field.label} {field.required && <span className="text-red-500">*</span>}
              </label>
              {field.helpText && <p className="text-sm text-gray-500 mt-1">{field.helpText}</p>}
            </div>
          </div>
        );

      default:
        return null;
    }
  }, [stepData, progress.currentStep, updateStepData]);

  // Render step content
  const renderStepContent = () => {
    if (!currentStepDef) {
      return <p className="text-gray-500">Loading step configuration...</p>;
    }

    // Special handling for certain steps
    if (progress.currentStep === 'bank_connection') {
      const businessProfile = stepData['business_profile'];
      return (
        <div className="space-y-4">
          <UnifiedConnectionsPanel
            token={token}
            variant="onboarding"
            jurisdiction={businessProfile?.country as string}
            entityType={businessProfile?.businessType as string}
          />
        </div>
      );
    }

    if (progress.currentStep === 'first_document') {
      return (
        <div className="space-y-4">
          <p className="text-gray-600">
            Upload a real receipt or invoice so you can see extraction, classification, validation, and posting in action.
          </p>
          <DocumentUpload
            token={token}
            variant="compact"
            source="onboarding"
            defaultType={DocumentType.RECEIPT}
            onUpload={() => {
              updateStepData('uploaded', true);
              updateStepData('lastUploadedAt', new Date().toISOString());
            }}
          />
        </div>
      );
    }

    if (progress.currentStep === 'complete') {
      return (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-gray-900">You're ready to explore the dashboard</h2>
          <p className="text-gray-600">
            The automation engine is active. Continue to the main experience to view live status, ingest additional data, or kick off filings.
          </p>
          <ul className="text-sm text-gray-600 list-disc ml-6 space-y-2">
            <li>Onboarding progress synced across devices.</li>
            <li>Assistant is primed with your business context.</li>
            <li>Alerts and reminders follow the preferences you set.</li>
          </ul>
        </div>
      );
    }

    // Render fields from schema
    return (
      <div className="space-y-4">
        {currentStepDef.fields.map(field => renderField(field))}
      </div>
    );
  };

  if (loadingSchema || !schema) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="rounded-2xl bg-white p-8">
          <p className="text-gray-600">Loading onboarding configuration...</p>
        </div>
      </div>
    );
  }

  const currentErrors = stepErrors[progress.currentStep] || [];
  const isSkippable = currentStepDef && !currentStepDef.required;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4">
      <div className="relative flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl lg:flex-row">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close onboarding wizard"
          className="absolute right-4 top-4 rounded-full border border-gray-200 p-1 text-gray-500 transition hover:text-gray-700"
        >
          ×
        </button>

        <aside className="w-full border-b border-gray-200 bg-gray-50 p-6 lg:w-1/3 lg:border-b-0 lg:border-r">
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-gray-500">Onboarding progress</p>
              <p className="text-3xl font-semibold text-gray-900">{completionPercent}%</p>
              <div className="mt-2 h-2 rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-blue-600 transition-all"
                  style={{ width: `${completionPercent}%` }}
                />
              </div>
              {schema.localization && (
                <p className="mt-2 text-xs text-gray-500">
                  Currency: {schema.localization.currencySymbol} ({schema.localization.currencyCode})
                </p>
              )}
            </div>

            <div className="space-y-3">
              {orderedSteps.map((step, index) => {
                const status = progress.completedSteps.includes(step.stepName as OnboardingStep)
                  ? 'done'
                  : step.stepName === progress.currentStep
                  ? 'active'
                  : 'pending';

                return (
                  <div key={step.stepName} className="flex items-start space-x-3">
                    <div
                      className={`mt-1 h-3 w-3 rounded-full ${
                        status === 'done'
                          ? 'bg-green-500'
                          : status === 'active'
                          ? 'bg-blue-600'
                          : 'bg-gray-300'
                      }`}
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">
                        {index + 1}. {step.title}{' '}
                        {!step.required && <span className="text-xs font-normal text-gray-500">(Optional)</span>}
                      </p>
                      <p className="text-xs text-gray-500">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        <section className="flex-1 p-6 lg:p-8">
          <div className="mb-6 space-y-2 pr-6">
            <p className="text-sm font-medium uppercase tracking-wide text-blue-600">
              Step {activeStepIndex + 1} of {totalSteps}
            </p>
            <h2 className="text-2xl font-semibold text-gray-900">{currentStepDef?.title}</h2>
            <p className="text-gray-600">{currentStepDef?.description}</p>
          </div>

          <div className="space-y-6 pr-6">
            {hydratingStep ? (
              <div className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                Loading saved responses…
              </div>
            ) : (
              renderStepContent()
            )}

            {currentErrors.length > 0 && (
              <div className="rounded border border-red-200 bg-red-50 px-4 py-2 space-y-1">
                {currentErrors.map((error, idx) => (
                  <p key={idx} className="text-sm text-red-700">{error}</p>
                ))}
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
            {isSkippable && (
              <button
                type="button"
                onClick={handleSkip}
                className="text-sm font-medium text-gray-500 underline hover:text-gray-700"
              >
                Skip for now
              </button>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || hydratingStep}
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {progress.currentStep === 'complete' ? 'Go to dashboard' : 'Save and continue'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
