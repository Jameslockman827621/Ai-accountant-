import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DocumentUpload from './DocumentUpload';
import { DocumentType } from '@ai-accountant/shared-types';
import UnifiedConnectionsPanel from './UnifiedConnectionsPanel';
import type {
  OnboardingEventType,
  OnboardingProgress,
  OnboardingStep,
} from '@/hooks/useOnboarding';
import { useOnboarding } from '@/hooks/useOnboarding';

interface OnboardingWizardProps {
  token: string;
  progress: OnboardingProgress;
  onStepComplete: (step: OnboardingStep, stepData?: Record<string, unknown>) => Promise<void>;
  onClose?: () => void;
  trackEvent?: (eventType: OnboardingEventType, stepName?: OnboardingStep, metadata?: Record<string, unknown>) => Promise<void>;
  isSubmitting: boolean;
  getStepData: (step: OnboardingStep) => Promise<Record<string, unknown> | null>;
}

type WizardState = {
  business_profile: {
    businessName: string;
    businessType: string;
    country: string;
    industry: string;
    vatNumber: string;
    employees: string;
  };
  tax_scope: {
    vatRegistered: boolean;
    taxObligations: string[];
    payrollEnabled: boolean;
  };
  chart_of_accounts: {
    template: 'standard' | 'retail' | 'saas' | 'services';
    autoSync: boolean;
    acknowledged: boolean;
  };
  bank_connection: {
    provider: 'truelayer' | 'plaid' | 'csv' | '';
    connectionStatus: 'pending' | 'connected' | 'skipped';
    notes: string;
  };
  historical_import: {
    sources: string[];
    yearsToImport: number;
    includeReceipts: boolean;
  };
  filing_preferences: {
    frequency: 'monthly' | 'quarterly' | 'annually';
    reviewProcess: 'single' | 'dual';
    remindersEnabled: boolean;
    reminderLeadDays: number;
  };
  first_document: {
    uploaded: boolean;
    lastUploadedAt: string | null;
  };
};

type WizardStateKey = keyof WizardState;

const STEP_DEFINITIONS: Array<{
  key: OnboardingStep;
  title: string;
  description: string;
  optional?: boolean;
}> = [
  {
    key: 'welcome',
    title: 'Welcome',
    description: 'A quick guided setup so we can automate your books end-to-end.',
  },
  {
    key: 'business_profile',
    title: 'Business profile',
    description: 'Foundational information for tax, compliance, and tailored playbooks.',
  },
  {
    key: 'tax_scope',
    title: 'Tax scope',
    description: 'Tell us which regimes and obligations apply so automations run safely.',
  },
  {
    key: 'chart_of_accounts',
    title: 'Chart mapping',
    description: 'Choose a template and confirm how we should classify activity.',
  },
  {
    key: 'bank_connection',
    title: 'Bank linking',
    description: 'Securely connect accounts or configure CSV fallbacks.',
    optional: true,
  },
  {
    key: 'historical_import',
    title: 'Historical import',
    description: 'Pull in prior years to keep filings, analytics, and AI context aligned.',
    optional: true,
  },
  {
    key: 'filing_preferences',
    title: 'Filing preferences',
    description: 'Confirm cadence, approvals, and reminders so nothing slips.',
  },
  {
    key: 'first_document',
    title: 'First document',
    description: 'Upload a live receipt or invoice to see the full AI review loop.',
    optional: true,
  },
  {
    key: 'complete',
    title: 'All set',
    description: 'Review what’s ready and head to the dashboard.',
  },
];

const STATEFUL_STEPS: WizardStateKey[] = [
  'business_profile',
  'tax_scope',
  'chart_of_accounts',
  'bank_connection',
  'historical_import',
  'filing_preferences',
  'first_document',
];

const SKIPPABLE_STEPS: OnboardingStep[] = ['bank_connection', 'historical_import', 'first_document'];

const createDefaultWizardState = (): WizardState => ({
  business_profile: {
    businessName: '',
    businessType: '',
    country: 'GB',
    industry: 'general',
    vatNumber: '',
    employees: '',
  },
  tax_scope: {
    vatRegistered: true,
    taxObligations: ['vat'],
    payrollEnabled: false,
  },
  chart_of_accounts: {
    template: 'standard',
    autoSync: true,
    acknowledged: false,
  },
  bank_connection: {
    provider: '',
    connectionStatus: 'pending',
    notes: '',
  },
  historical_import: {
    sources: [],
    yearsToImport: 1,
    includeReceipts: true,
  },
  filing_preferences: {
    frequency: 'quarterly',
    reviewProcess: 'single',
    remindersEnabled: true,
    reminderLeadDays: 5,
  },
  first_document: {
    uploaded: false,
    lastUploadedAt: null,
  },
});

export default function OnboardingWizard({
  token,
  progress,
  onStepComplete,
  onClose,
  trackEvent,
  isSubmitting,
  getStepData,
}: OnboardingWizardProps) {
  const { getSchema, saveStepData } = useOnboarding(token);
  const [wizardState, setWizardState] = useState<WizardState>(() => createDefaultWizardState());
  const [stepError, setStepError] = useState<string | null>(null);
  const [hydratingStep, setHydratingStep] = useState(false);
  const [schema, setSchema] = useState<any>(null);
  const hydratedSteps = useRef<Set<OnboardingStep>>(new Set());
  const lastTrackedStep = useRef<OnboardingStep | null>(null);

  // Load schema when jurisdiction is available
  useEffect(() => {
    const loadSchema = async () => {
      const jurisdiction = wizardState.business_profile.country || 'GB';
      try {
        const schemaData = await getSchema(
          jurisdiction,
          wizardState.business_profile.businessType || undefined,
          wizardState.business_profile.industry || undefined
        );
        if (schemaData) {
          setSchema(schemaData);
        }
      } catch (err) {
        console.error('Failed to load schema', err);
      }
    };

    if (wizardState.business_profile.country) {
      void loadSchema();
    }
  }, [wizardState.business_profile.country, wizardState.business_profile.businessType, wizardState.business_profile.industry, getSchema]);

  const activeStepIndex = useMemo(() => {
    const idx = STEP_DEFINITIONS.findIndex(step => step.key === progress.currentStep);
    return idx === -1 ? 0 : idx;
  }, [progress.currentStep]);

  const activeDefinition = STEP_DEFINITIONS[activeStepIndex] ?? STEP_DEFINITIONS[0];
  const totalSteps = STEP_DEFINITIONS.length;
  const completionPercent = useMemo(() => {
    return Math.min(
      100,
      Math.round(((activeStepIndex + (progress.completedSteps.includes(activeDefinition.key) ? 1 : 0)) / totalSteps) * 100)
    );
  }, [activeStepIndex, activeDefinition.key, progress.completedSteps, totalSteps]);

  useEffect(() => {
    if (!trackEvent) {
      return;
    }
    if (lastTrackedStep.current === progress.currentStep) {
      return;
    }

    trackEvent('step_viewed', progress.currentStep, {
      progress: progress.progress,
    });
    lastTrackedStep.current = progress.currentStep;
  }, [progress.currentStep, progress.progress, trackEvent]);

  useEffect(() => {
    const hydrate = async () => {
      if (!STATEFUL_STEPS.includes(progress.currentStep as WizardStateKey)) {
        return;
      }
      if (hydratedSteps.current.has(progress.currentStep)) {
        return;
      }
      setHydratingStep(true);
      try {
        const serverData = await getStepData(progress.currentStep);
        if (serverData) {
          setWizardState(prev => mergeStateFromServer(prev, progress.currentStep as WizardStateKey, serverData));
        }
        hydratedSteps.current.add(progress.currentStep);
      } finally {
        setHydratingStep(false);
      }
    };

    void hydrate();
  }, [getStepData, progress.currentStep]);

  useEffect(() => {
    if (progress.completedSteps.includes('complete') && onClose) {
      onClose();
    }
  }, [onClose, progress.completedSteps]);

  const updateState = useCallback(
    <K extends WizardStateKey>(key: K, values: Partial<WizardState[K]>) => {
      setWizardState(prev => ({
        ...prev,
        [key]: {
          ...prev[key],
          ...values,
        },
      }));
    },
    []
  );

  const handleSubmit = useCallback(async () => {
    setStepError(null);

    const validationError = validateStep(activeDefinition.key, wizardState);
    if (validationError) {
      setStepError(validationError);
      return;
    }

    const payload = buildPayload(activeDefinition.key, wizardState);

    try {
      // Save as draft if schema is available
      if (schema && wizardState.business_profile.country) {
        await saveStepData(
          activeDefinition.key,
          payload,
          wizardState.business_profile.country,
          wizardState.business_profile.businessType || undefined,
          wizardState.business_profile.industry || undefined
        );
      }

      await onStepComplete(activeDefinition.key, payload);
    } catch (error) {
      setStepError(error instanceof Error ? error.message : 'Unable to complete this step right now.');
    }
  }, [activeDefinition.key, onStepComplete, wizardState, schema, saveStepData]);

  const handleSkip = useCallback(async () => {
    setStepError(null);
    try {
      await onStepComplete(activeDefinition.key, { skipped: true });
    } catch (error) {
      setStepError(error instanceof Error ? error.message : 'Unable to skip this step.');
    }
  }, [activeDefinition.key, onStepComplete]);

  const renderStepContent = () => {
    switch (activeDefinition.key) {
      case 'welcome':
        return (
          <div className="text-center space-y-4">
            <h2 className="text-2xl font-semibold text-gray-900">Welcome to your financial command center</h2>
            <p className="text-gray-600">
              We’ll configure the essentials so the AI accountant can reconcile documents, filings, and bank feeds on day one.
            </p>
            <p className="text-sm text-gray-500">Expect about 6 minutes to finish. You can pause anytime.</p>
          </div>
        );
      case 'business_profile':
        return (
          <div className="space-y-4">
            <InputField
              label="Legal business name"
              value={wizardState.business_profile.businessName}
              onChange={value => updateState('business_profile', { businessName: value })}
              placeholder="Acme Consulting Ltd"
            />
            <SelectField
              label="Business type"
              value={wizardState.business_profile.businessType}
              onChange={value => updateState('business_profile', { businessType: value })}
              options={[
                { value: '', label: 'Select type' },
                { value: 'sole_trader', label: 'Sole trader' },
                { value: 'partnership', label: 'Partnership' },
                { value: 'limited_company', label: 'Limited company' },
                { value: 'llp', label: 'LLP' },
              ]}
            />
            <SelectField
              label="Country of operation"
              value={wizardState.business_profile.country}
              onChange={value => updateState('business_profile', { country: value })}
              options={[
                { value: 'GB', label: 'United Kingdom' },
                { value: 'IE', label: 'Ireland' },
                { value: 'US', label: 'United States' },
                { value: 'CA', label: 'Canada' },
                { value: 'AU', label: 'Australia' },
                { value: 'SG', label: 'Singapore' },
                { value: 'MX', label: 'Mexico' },
              ]}
            />
            <SelectField
              label="Industry"
              value={wizardState.business_profile.industry}
              onChange={value => updateState('business_profile', { industry: value })}
              options={[
                { value: 'general', label: 'General / Other' },
                { value: 'retail', label: 'Retail & eCommerce' },
                { value: 'saas', label: 'Software / SaaS' },
                { value: 'services', label: 'Professional services' },
              ]}
            />
            <InputField
              label={schema?.localization?.currencyCode === 'GBP' ? 'VAT number (optional)' : schema?.localization?.currencyCode === 'USD' ? 'Sales Tax ID (optional)' : 'Tax Registration Number (optional)'}
              value={wizardState.business_profile.vatNumber}
              onChange={value => updateState('business_profile', { vatNumber: value })}
              placeholder={schema?.localization?.currencyCode === 'GBP' ? 'GB123456789' : schema?.localization?.currencyCode === 'USD' ? 'State-specific format' : 'Enter registration number'}
            />
            <InputField
              label="Employees / contractors"
              value={wizardState.business_profile.employees}
              onChange={value => updateState('business_profile', { employees: value })}
              placeholder="10"
            />
          </div>
        );
      case 'tax_scope':
        return (
          <div className="space-y-4">
            <ToggleField
              label="VAT registered"
              description="We’ll schedule VAT submissions and validation checks."
              value={wizardState.tax_scope.vatRegistered}
              onChange={value => updateState('tax_scope', { vatRegistered: value })}
            />
            <CheckboxGroupField
              label="Which tax obligations apply?"
              value={wizardState.tax_scope.taxObligations}
              onChange={value => updateState('tax_scope', { taxObligations: value })}
              options={[
                { value: 'vat', label: 'VAT' },
                { value: 'paye', label: 'PAYE' },
                { value: 'ct600', label: 'Corporation tax' },
                { value: 'self_assessment', label: 'Self assessment' },
              ]}
            />
            <ToggleField
              label="Payroll (PAYE) managed in platform?"
              value={wizardState.tax_scope.payrollEnabled}
              onChange={value => updateState('tax_scope', { payrollEnabled: value })}
            />
          </div>
        );
      case 'chart_of_accounts':
        return (
          <div className="space-y-4">
            <SelectField
              label="Choose a starting template"
              value={wizardState.chart_of_accounts.template}
              onChange={value => updateState('chart_of_accounts', { template: value as WizardState['chart_of_accounts']['template'] })}
              options={[
                { value: 'standard', label: 'Standard UK GAAP' },
                { value: 'retail', label: 'Retail & inventory' },
                { value: 'saas', label: 'SaaS & recurring revenue' },
                { value: 'services', label: 'Professional services' },
              ]}
            />
            <ToggleField
              label="Auto-sync chart after review"
              description="AI will auto-classify new accounts and propose mappings."
              value={wizardState.chart_of_accounts.autoSync}
              onChange={value => updateState('chart_of_accounts', { autoSync: value })}
            />
            <label className="flex items-start space-x-3 rounded border border-gray-200 p-3">
              <input
                type="checkbox"
                className="mt-1"
                checked={wizardState.chart_of_accounts.acknowledged}
                onChange={e => updateState('chart_of_accounts', { acknowledged: e.target.checked })}
              />
              <span className="text-sm text-gray-700">
                I confirm the initial chart aligns with our reporting and understand I can adjust anytime.
              </span>
            </label>
          </div>
        );
      case 'bank_connection':
        return (
          <div className="space-y-4">
            <SelectField
              label="Preferred bank connector"
              value={wizardState.bank_connection.provider}
              onChange={value => updateState('bank_connection', { provider: value as WizardState['bank_connection']['provider'] })}
              options={[
                { value: '', label: 'Select connector' },
                { value: 'truelayer', label: 'TrueLayer (UK/EU)' },
                { value: 'plaid', label: 'Plaid (US/EU)' },
                { value: 'csv', label: 'Manual CSV upload' },
              ]}
            />
            <SelectField
              label="Connection status"
              value={wizardState.bank_connection.connectionStatus}
              onChange={value => updateState('bank_connection', { connectionStatus: value as WizardState['bank_connection']['connectionStatus'] })}
              options={[
                { value: 'pending', label: 'Pending connection' },
                { value: 'connected', label: 'Connected' },
                { value: 'skipped', label: 'Will provide later' },
              ]}
            />
            <textarea
              className="w-full rounded border px-3 py-2 text-sm text-gray-700"
              rows={3}
              placeholder="Add notes or restrictions (e.g. restricted accounts, read-only access, etc.)"
              value={wizardState.bank_connection.notes}
              onChange={e => updateState('bank_connection', { notes: e.target.value })}
            />
            <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-4">
              {token ? (
                <UnifiedConnectionsPanel
                  token={token}
                  variant="onboarding"
                  jurisdiction={wizardState.business_profile.country}
                  entityType={wizardState.business_profile.businessType}
                />
              ) : (
                <p className="text-sm text-blue-900">
                  Sign in again to link your bank feeds directly from onboarding.
                </p>
              )}
              <p className="mt-2 text-xs text-blue-900">
                We’ll auto-update this step once at least one connection is active. Prefer to finish later? mark the
                status as “Will provide later.”
              </p>
            </div>
          </div>
        );
      case 'historical_import':
        return (
          <div className="space-y-4">
            <CheckboxGroupField
              label="Import sources"
              hint="We’ll queue connectors or send you the secure upload link."
              value={wizardState.historical_import.sources}
              onChange={value => updateState('historical_import', { sources: value })}
              options={[
                { value: 'csv', label: 'CSV / Excel exports' },
                { value: 'quickbooks', label: 'QuickBooks' },
                { value: 'xero', label: 'Xero' },
                { value: 'freeagent', label: 'FreeAgent' },
              ]}
            />
            <InputField
              label="Years to import"
              type="number"
              min={1}
              max={6}
              value={String(wizardState.historical_import.yearsToImport)}
              onChange={value => updateState('historical_import', { yearsToImport: Number(value) || 1 })}
            />
            <ToggleField
              label="Include receipts & attachments"
              value={wizardState.historical_import.includeReceipts}
              onChange={value => updateState('historical_import', { includeReceipts: value })}
            />
          </div>
        );
        case 'filing_preferences':
          return (
            <div className="space-y-4">
              <SelectField
                label="Filing frequency"
                value={wizardState.filing_preferences.frequency}
                onChange={value =>
                  updateState('filing_preferences', {
                    frequency: value as WizardState['filing_preferences']['frequency'],
                  })
                }
                options={[
                  { value: 'monthly', label: 'Monthly' },
                  { value: 'quarterly', label: 'Quarterly' },
                  { value: 'annually', label: 'Annually' },
                ]}
              />
              <SelectField
                label="Review workflow"
                value={wizardState.filing_preferences.reviewProcess}
                onChange={value =>
                  updateState('filing_preferences', {
                    reviewProcess: value as WizardState['filing_preferences']['reviewProcess'],
                  })
                }
                options={[
                  { value: 'single', label: 'Single approver (accountant)' },
                  { value: 'dual', label: 'Dual control (finance + director)' },
                ]}
              />
              <ToggleField
                label="Deadline reminders"
                description="Send proactive notifications before every filing deadline."
                value={wizardState.filing_preferences.remindersEnabled}
                onChange={value => updateState('filing_preferences', { remindersEnabled: value })}
              />
              {wizardState.filing_preferences.remindersEnabled && (
                <InputField
                  label="Days before due date"
                  type="number"
                  min={1}
                  max={30}
                  value={String(wizardState.filing_preferences.reminderLeadDays)}
                  onChange={value =>
                    updateState('filing_preferences', { reminderLeadDays: Number(value) || 5 })
                  }
                />
              )}
            </div>
          );
        case 'first_document':
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
                  updateState('first_document', {
                    uploaded: true,
                    lastUploadedAt: new Date().toISOString(),
                  });
                }}
              />
            {wizardState.first_document.uploaded && (
              <div className="rounded border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
                Document received {new Date(wizardState.first_document.lastUploadedAt || '').toLocaleString()}.
              </div>
            )}
          </div>
        );
      case 'complete':
      default:
        return (
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold text-gray-900">You’re ready to explore the dashboard</h2>
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
  };

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
            </div>

            <div className="space-y-3">
              {STEP_DEFINITIONS.map((step, index) => {
                const status = progress.completedSteps.includes(step.key)
                  ? 'done'
                  : step.key === activeDefinition.key
                  ? 'active'
                  : 'pending';

                return (
                  <div key={step.key} className="flex items-start space-x-3">
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
                        {step.optional && <span className="text-xs font-normal text-gray-500">(Optional)</span>}
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
            <h2 className="text-2xl font-semibold text-gray-900">{activeDefinition.title}</h2>
            <p className="text-gray-600">{activeDefinition.description}</p>
          </div>

          <div className="space-y-6 pr-6">
            {hydratingStep ? (
              <div className="rounded border border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                Loading saved responses…
              </div>
            ) : (
              renderStepContent()
            )}

            {stepError && (
              <div className="rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                {stepError}
              </div>
            )}
          </div>

          <div className="mt-8 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
            {SKIPPABLE_STEPS.includes(activeDefinition.key) && (
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
                {activeDefinition.key === 'complete' ? 'Go to dashboard' : 'Save and continue'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function mergeStateFromServer(state: WizardState, key: WizardStateKey, serverData: Record<string, unknown>): WizardState {
  switch (key) {
    case 'business_profile':
      return {
        ...state,
        business_profile: {
          businessName: String(serverData.businessName ?? state.business_profile.businessName),
          businessType: String(serverData.businessType ?? state.business_profile.businessType),
          country: String(serverData.country ?? state.business_profile.country),
          industry: String(serverData.industry ?? state.business_profile.industry),
          vatNumber: String(serverData.vatNumber ?? state.business_profile.vatNumber),
          employees: String(serverData.employees ?? state.business_profile.employees),
        },
      };
    case 'tax_scope':
      return {
        ...state,
        tax_scope: {
          vatRegistered: Boolean(serverData.vatRegistered ?? state.tax_scope.vatRegistered),
          taxObligations: Array.isArray(serverData.taxObligations)
            ? (serverData.taxObligations as string[])
            : state.tax_scope.taxObligations,
          payrollEnabled: Boolean(serverData.payrollEnabled ?? state.tax_scope.payrollEnabled),
        },
      };
    case 'chart_of_accounts':
      return {
        ...state,
        chart_of_accounts: {
          template: (serverData.template as WizardState['chart_of_accounts']['template']) ?? state.chart_of_accounts.template,
          autoSync: Boolean(serverData.autoSync ?? state.chart_of_accounts.autoSync),
          acknowledged: Boolean(serverData.acknowledged ?? state.chart_of_accounts.acknowledged),
        },
      };
    case 'bank_connection':
      return {
        ...state,
        bank_connection: {
          provider: (serverData.provider as WizardState['bank_connection']['provider']) ?? state.bank_connection.provider,
          connectionStatus:
            (serverData.connectionStatus as WizardState['bank_connection']['connectionStatus']) ?? state.bank_connection.connectionStatus,
          notes: String(serverData.notes ?? state.bank_connection.notes),
        },
      };
    case 'historical_import':
      return {
        ...state,
        historical_import: {
          sources: Array.isArray(serverData.sources) ? (serverData.sources as string[]) : state.historical_import.sources,
          yearsToImport: Number(serverData.yearsToImport ?? state.historical_import.yearsToImport),
          includeReceipts: Boolean(serverData.includeReceipts ?? state.historical_import.includeReceipts),
        },
      };
    case 'filing_preferences':
      return {
        ...state,
        filing_preferences: {
          frequency:
            (serverData.frequency as WizardState['filing_preferences']['frequency']) ?? state.filing_preferences.frequency,
          reviewProcess:
            (serverData.reviewProcess as WizardState['filing_preferences']['reviewProcess']) ?? state.filing_preferences.reviewProcess,
          remindersEnabled: Boolean(serverData.remindersEnabled ?? state.filing_preferences.remindersEnabled),
          reminderLeadDays: Number(serverData.reminderLeadDays ?? state.filing_preferences.reminderLeadDays),
        },
      };
    case 'first_document':
      return {
        ...state,
        first_document: {
          uploaded: Boolean(serverData.uploaded ?? state.first_document.uploaded),
          lastUploadedAt: (serverData.lastUploadedAt as string | null) ?? state.first_document.lastUploadedAt,
        },
      };
    default:
      return state;
  }
}

function buildPayload(step: OnboardingStep, state: WizardState): Record<string, unknown> | undefined {
  switch (step) {
    case 'business_profile':
      return state.business_profile;
    case 'tax_scope':
      return state.tax_scope;
    case 'chart_of_accounts':
      return state.chart_of_accounts;
    case 'bank_connection':
      return state.bank_connection;
    case 'historical_import':
      return state.historical_import;
    case 'filing_preferences':
      return state.filing_preferences;
    case 'first_document':
      return state.first_document;
    case 'complete':
      return { completedAt: new Date().toISOString() };
    default:
      return undefined;
  }
}

function validateStep(step: OnboardingStep, state: WizardState): string | null {
  switch (step) {
    case 'business_profile': {
      if (!state.business_profile.businessName) return 'Please tell us your legal business name.';
      if (!state.business_profile.businessType) return 'Select the entity type that best describes your business.';
      if (!state.business_profile.country) return 'Choose your primary country of operation.';
      return null;
    }
    case 'tax_scope': {
      if (!state.tax_scope.taxObligations.length) return 'Select at least one tax obligation so we set up the right workflows.';
      return null;
    }
    case 'chart_of_accounts': {
      if (!state.chart_of_accounts.acknowledged) return 'Please confirm the chart of accounts looks correct.';
      return null;
    }
    case 'bank_connection': {
      if (state.bank_connection.connectionStatus === 'pending') {
        return 'Mark the connection as connected or use skip if you plan to add it later.';
      }
      return null;
    }
    case 'filing_preferences': {
      if (!state.filing_preferences.frequency) return 'Choose a filing frequency.';
      return null;
    }
    case 'first_document': {
      if (!state.first_document.uploaded) return 'Upload at least one document or skip this step.';
      return null;
    }
    default:
      return null;
  }
}

interface InputFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  onChange: (value: string) => void;
}

function InputField({ label, value, placeholder, type = 'text', min, max, onChange }: InputFieldProps) {
  return (
    <label className="block text-sm font-medium text-gray-700">
      <span>{label}</span>
      <input
        type={type}
        min={min}
        max={max}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </label>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  hint?: string;
}

function SelectField({ label, value, options, onChange, hint }: SelectFieldProps) {
  return (
    <label className="block text-sm font-medium text-gray-700">
      <span>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </label>
  );
}

interface ToggleFieldProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  description?: string;
}

function ToggleField({ label, value, onChange, description }: ToggleFieldProps) {
  return (
    <div className="flex items-start justify-between rounded border border-gray-200 p-4">
      <div>
        <p className="font-medium text-gray-800">{label}</p>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      <button
        type="button"
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
          value ? 'bg-blue-600' : 'bg-gray-300'
        }`}
        onClick={() => onChange(!value)}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
            value ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

interface CheckboxGroupFieldProps {
  label: string;
  hint?: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (value: string[]) => void;
}

function CheckboxGroupField({ label, hint, options, value, onChange }: CheckboxGroupFieldProps) {
  const toggle = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter(item => item !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-gray-700">{label}</legend>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      {options.map(option => (
        <label key={option.value} className="flex items-center space-x-3 rounded border border-gray-200 px-3 py-2">
          <input
            type="checkbox"
            checked={value.includes(option.value)}
            onChange={() => toggle(option.value)}
            className="h-4 w-4"
          />
          <span className="text-sm text-gray-700">{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
