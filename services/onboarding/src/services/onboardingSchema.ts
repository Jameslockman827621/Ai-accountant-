import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('onboarding-schema-service');

export interface OnboardingStepSchema {
  stepName: string;
  title: string;
  description: string;
  enabled: boolean;
  required: boolean;
  fields: OnboardingFieldSchema[];
  validationRules: ValidationRule[];
  order: number;
}

export interface OnboardingFieldSchema {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox' | 'date' | 'email' | 'tel';
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
}

export interface ValidationRule {
  field: string;
  type: 'required' | 'regex' | 'minLength' | 'maxLength' | 'min' | 'max' | 'email' | 'custom';
  value?: string | number;
  message: string;
}

export interface LocalizationConfig {
  currencyCode: string;
  currencySymbol: string;
  dateFormat: string;
  timezone: string;
  numberFormat: {
    decimalSeparator: string;
    thousandSeparator: string;
  };
}

export interface OnboardingSchemaResponse {
  jurisdiction: string;
  entityType?: string;
  industry?: string;
  steps: OnboardingStepSchema[];
  localization: LocalizationConfig;
  enabledSteps: string[];
  requiredSteps: string[];
}

/**
 * Get onboarding schema for a jurisdiction
 */
export async function getOnboardingSchema(
  jurisdictionCode: string,
    entityType?: string,
    industry?: string
): Promise<OnboardingSchemaResponse> {
  try {
    // Get jurisdiction info
    const jurisdictionResult = await db.query<{
      code: string;
      name: string;
      currency_code: string;
      currency_symbol: string;
      date_format: string;
      timezone: string;
    }>(
      'SELECT code, name, currency_code, currency_symbol, date_format, timezone FROM jurisdictions WHERE code = $1 AND enabled = true',
      [jurisdictionCode]
    );

    if (jurisdictionResult.rows.length === 0) {
      throw new Error(`Jurisdiction ${jurisdictionCode} not found or disabled`);
    }

    const jurisdiction = jurisdictionResult.rows[0];

    // Build localization config
    const localization: LocalizationConfig = {
      currencyCode: jurisdiction.currency_code,
      currencySymbol: jurisdiction.currency_symbol,
      dateFormat: jurisdiction.date_format,
      timezone: jurisdiction.timezone,
      numberFormat: getNumberFormat(jurisdictionCode),
    };

    // Get steps configuration based on jurisdiction and entity type
    const steps = getStepsForJurisdiction(jurisdictionCode, entityType, industry);

    const enabledSteps = steps.filter(s => s.enabled).map(s => s.stepName);
    const requiredSteps = steps.filter(s => s.required).map(s => s.stepName);

    return {
      jurisdiction: jurisdictionCode,
      entityType,
      industry,
      steps,
      localization,
      enabledSteps,
      requiredSteps,
    };
  } catch (error) {
    logger.error('Failed to get onboarding schema', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

/**
 * Get number format for a jurisdiction
 */
function getNumberFormat(jurisdictionCode: string): { decimalSeparator: string; thousandSeparator: string } {
  // UK, AU, IE use period for decimal, comma for thousands
  if (['GB', 'AU', 'IE'].includes(jurisdictionCode)) {
    return { decimalSeparator: '.', thousandSeparator: ',' };
  }
  // US, CA use period for decimal, comma for thousands
  if (['US', 'CA'].includes(jurisdictionCode)) {
    return { decimalSeparator: '.', thousandSeparator: ',' };
  }
  // Default
  return { decimalSeparator: '.', thousandSeparator: ',' };
}

/**
 * Get steps configuration for a jurisdiction
 */
function getStepsForJurisdiction(
  jurisdictionCode: string,
  _entityType?: string | null,
  _industry?: string
): OnboardingStepSchema[] {
  const baseSteps: OnboardingStepSchema[] = [
    {
      stepName: 'welcome',
      title: 'Welcome',
      description: 'A quick guided setup so we can automate your books end-to-end.',
      enabled: true,
      required: true,
      fields: [],
      validationRules: [],
      order: 1,
    },
    {
      stepName: 'business_profile',
      title: 'Business Profile',
      description: 'Foundational information for tax, compliance, and tailored playbooks.',
      enabled: true,
      required: true,
      fields: [
        {
          name: 'businessName',
          label: 'Legal Business Name',
          type: 'text',
          required: true,
          placeholder: 'Acme Consulting Ltd',
          minLength: 2,
          maxLength: 255,
        },
        {
          name: 'businessType',
          label: 'Business Type',
          type: 'select',
          required: true,
          options: getEntityTypeOptions(jurisdictionCode),
        },
        {
          name: 'country',
          label: 'Country of Operation',
          type: 'select',
          required: true,
          options: [{ value: jurisdictionCode, label: getCountryName(jurisdictionCode) }],
          defaultValue: jurisdictionCode,
        },
        {
          name: 'industry',
          label: 'Industry',
          type: 'select',
          required: false,
          options: [
            { value: 'general', label: 'General / Other' },
            { value: 'retail', label: 'Retail & eCommerce' },
            { value: 'saas', label: 'Software / SaaS' },
            { value: 'services', label: 'Professional Services' },
            { value: 'manufacturing', label: 'Manufacturing' },
            { value: 'healthcare', label: 'Healthcare' },
            { value: 'real_estate', label: 'Real Estate' },
          ],
        },
        {
          name: 'vatNumber',
          label: getVATLabel(jurisdictionCode),
          type: 'text',
          required: false,
          placeholder: getVATPlaceholder(jurisdictionCode),
          regex: getVATRegex(jurisdictionCode),
        },
        {
          name: 'employees',
          label: 'Number of Employees',
          type: 'number',
          required: false,
          min: 0,
          max: 100000,
        },
      ],
      validationRules: [
        {
          field: 'businessName',
          type: 'required',
          message: 'Business name is required',
        },
        {
          field: 'businessType',
          type: 'required',
          message: 'Business type is required',
        },
      ],
      order: 2,
    },
    {
      stepName: 'tax_scope',
      title: 'Tax Scope',
      description: 'Tell us which regimes and obligations apply so automations run safely.',
      enabled: true,
      required: true,
      fields: [
        {
          name: 'vatRegistered',
          label: getVATRegisteredLabel(jurisdictionCode),
          type: 'checkbox',
          required: false,
          defaultValue: false,
        },
        {
          name: 'taxObligations',
          label: 'Which tax obligations apply?',
          type: 'select',
          required: true,
          options: getTaxObligations(jurisdictionCode),
        },
        {
          name: 'payrollEnabled',
          label: getPayrollLabel(jurisdictionCode),
          type: 'checkbox',
          required: false,
          defaultValue: false,
        },
      ],
      validationRules: [
        {
          field: 'taxObligations',
          type: 'required',
          message: 'Select at least one tax obligation',
        },
      ],
      order: 3,
    },
    {
      stepName: 'chart_of_accounts',
      title: 'Chart Mapping',
      description: 'Choose a template and confirm how we should classify activity.',
      enabled: true,
      required: true,
      fields: [
        {
          name: 'template',
          label: 'Choose a starting template',
          type: 'select',
          required: true,
          options: [
            { value: 'standard', label: 'Standard Chart' },
            { value: 'retail', label: 'Retail & Inventory' },
            { value: 'saas', label: 'SaaS & Recurring Revenue' },
            { value: 'services', label: 'Professional Services' },
          ],
          defaultValue: 'standard',
        },
        {
          name: 'autoSync',
          label: 'Auto-sync chart after review',
          type: 'checkbox',
          required: false,
          defaultValue: true,
        },
        {
          name: 'acknowledged',
          label: 'I confirm the initial chart aligns with our reporting',
          type: 'checkbox',
          required: true,
          defaultValue: false,
        },
      ],
      validationRules: [
        {
          field: 'acknowledged',
          type: 'required',
          message: 'Please confirm the chart of accounts',
        },
      ],
      order: 4,
    },
    {
      stepName: 'bank_connection',
      title: 'Bank Linking',
      description: 'Securely connect accounts or configure CSV fallbacks.',
      enabled: true,
      required: false,
      fields: [
        {
          name: 'provider',
          label: 'Preferred bank connector',
          type: 'select',
          required: false,
          options: getBankProviderOptions(jurisdictionCode),
        },
      ],
      validationRules: [],
      order: 5,
    },
    {
      stepName: 'historical_import',
      title: 'Historical Import',
      description: 'Pull in prior years to keep filings, analytics, and AI context aligned.',
      enabled: true,
      required: false,
      fields: [
        {
          name: 'sources',
          label: 'Import sources',
          type: 'select',
          required: false,
          options: [
            { value: 'csv', label: 'CSV / Excel exports' },
            { value: 'quickbooks', label: 'QuickBooks' },
            { value: 'xero', label: 'Xero' },
            { value: 'freeagent', label: 'FreeAgent' },
          ],
        },
        {
          name: 'yearsToImport',
          label: 'Years to import',
          type: 'number',
          required: false,
          min: 1,
          max: 6,
          defaultValue: 1,
        },
        {
          name: 'includeReceipts',
          label: 'Include receipts & attachments',
          type: 'checkbox',
          required: false,
          defaultValue: true,
        },
      ],
      validationRules: [],
      order: 6,
    },
    {
      stepName: 'filing_preferences',
      title: 'Filing Preferences',
      description: 'Confirm cadence, approvals, and reminders so nothing slips.',
      enabled: true,
      required: true,
      fields: [
        {
          name: 'frequency',
          label: 'Filing frequency',
          type: 'select',
          required: true,
          options: [
            { value: 'monthly', label: 'Monthly' },
            { value: 'quarterly', label: 'Quarterly' },
            { value: 'annually', label: 'Annually' },
          ],
          defaultValue: 'quarterly',
        },
        {
          name: 'reviewProcess',
          label: 'Review workflow',
          type: 'select',
          required: true,
          options: [
            { value: 'single', label: 'Single approver (accountant)' },
            { value: 'dual', label: 'Dual control (finance + director)' },
          ],
          defaultValue: 'single',
        },
        {
          name: 'remindersEnabled',
          label: 'Deadline reminders',
          type: 'checkbox',
          required: false,
          defaultValue: true,
        },
        {
          name: 'reminderLeadDays',
          label: 'Days before due date',
          type: 'number',
          required: false,
          min: 1,
          max: 30,
          defaultValue: 5,
        },
      ],
      validationRules: [
        {
          field: 'frequency',
          type: 'required',
          message: 'Filing frequency is required',
        },
      ],
      order: 7,
    },
    {
      stepName: 'first_document',
      title: 'First Document',
      description: 'Upload a live receipt or invoice to see the full AI review loop.',
      enabled: true,
      required: false,
      fields: [],
      validationRules: [],
      order: 8,
    },
    {
      stepName: 'complete',
      title: 'All Set',
      description: "Review what's ready and head to the dashboard.",
      enabled: true,
      required: true,
      fields: [],
      validationRules: [],
      order: 9,
    },
  ];

  return baseSteps;
}

function getEntityTypeOptions(jurisdictionCode: string): Array<{ value: string; label: string }> {
  const options: Record<string, Array<{ value: string; label: string }>> = {
    GB: [
      { value: 'sole_trader', label: 'Sole Trader' },
      { value: 'partnership', label: 'Partnership' },
      { value: 'limited_company', label: 'Limited Company' },
      { value: 'llp', label: 'LLP' },
    ],
    US: [
      { value: 'sole_proprietorship', label: 'Sole Proprietorship' },
      { value: 'llc', label: 'LLC' },
      { value: 'corporation', label: 'Corporation' },
    ],
    CA: [
      { value: 'sole_proprietorship', label: 'Sole Proprietorship' },
      { value: 'corporation', label: 'Corporation' },
    ],
  };

  return options[jurisdictionCode] || options.GB;
}

function getCountryName(code: string): string {
  const names: Record<string, string> = {
    GB: 'United Kingdom',
    US: 'United States',
    CA: 'Canada',
    AU: 'Australia',
    SG: 'Singapore',
    IE: 'Ireland',
    MX: 'Mexico',
  };
  return names[code] || code;
}

function getVATLabel(jurisdictionCode: string): string {
  const labels: Record<string, string> = {
    GB: 'VAT Number',
    US: 'Sales Tax ID',
    CA: 'GST/HST Number',
    AU: 'ABN',
    SG: 'GST Registration Number',
    IE: 'VAT Number',
    MX: 'RFC',
  };
  return labels[jurisdictionCode] || 'Tax Registration Number';
}

function getVATPlaceholder(jurisdictionCode: string): string {
  const placeholders: Record<string, string> = {
    GB: 'GB123456789',
    US: 'State-specific format',
    CA: '123456789RT0001',
    AU: '12 345 678 901',
    SG: '200012345D',
    IE: 'IE1234567T',
    MX: 'ABC123456D01',
  };
  return placeholders[jurisdictionCode] || 'Enter registration number';
}

function getVATRegex(jurisdictionCode: string): string | undefined {
  const regexes: Record<string, string> = {
    GB: '^GB[0-9]{9}$',
    IE: '^IE[0-9]{7}[A-Z]{1,2}$',
  };
  return regexes[jurisdictionCode];
}

function getVATRegisteredLabel(jurisdictionCode: string): string {
  const labels: Record<string, string> = {
    GB: 'VAT registered',
    US: 'Sales tax registered',
    CA: 'GST/HST registered',
    AU: 'GST registered',
    SG: 'GST registered',
    IE: 'VAT registered',
    MX: 'RFC registered',
  };
  return labels[jurisdictionCode] || 'Tax registered';
}

function getPayrollLabel(jurisdictionCode: string): string {
  const labels: Record<string, string> = {
    GB: 'Payroll (PAYE) managed in platform?',
    US: 'Payroll managed in platform?',
    CA: 'Payroll managed in platform?',
    AU: 'Payroll managed in platform?',
    SG: 'Payroll managed in platform?',
    IE: 'Payroll (PAYE) managed in platform?',
    MX: 'Payroll managed in platform?',
  };
  return labels[jurisdictionCode] || 'Payroll managed in platform?';
}

function getTaxObligations(jurisdictionCode: string): Array<{ value: string; label: string }> {
  const obligations: Record<string, Array<{ value: string; label: string }>> = {
    GB: [
      { value: 'vat', label: 'VAT' },
      { value: 'paye', label: 'PAYE' },
      { value: 'ct600', label: 'Corporation Tax' },
      { value: 'self_assessment', label: 'Self Assessment' },
    ],
    US: [
      { value: 'sales_tax', label: 'Sales Tax' },
      { value: 'payroll_tax', label: 'Payroll Tax' },
      { value: 'income_tax', label: 'Income Tax' },
      { value: 'federal_tax', label: 'Federal Tax' },
    ],
    CA: [
      { value: 'gst', label: 'GST/HST' },
      { value: 'payroll', label: 'Payroll' },
      { value: 'corporate_tax', label: 'Corporate Tax' },
    ],
  };

  return obligations[jurisdictionCode] || obligations.GB;
}

function getBankProviderOptions(jurisdictionCode: string): Array<{ value: string; label: string }> {
  const providers: Record<string, Array<{ value: string; label: string }>> = {
    GB: [
      { value: 'truelayer', label: 'TrueLayer (UK/EU)' },
      { value: 'yodlee', label: 'Yodlee' },
      { value: 'codat', label: 'Codat' },
      { value: 'csv', label: 'Manual CSV upload' },
    ],
    US: [
      { value: 'plaid', label: 'Plaid (US)' },
      { value: 'yodlee', label: 'Yodlee' },
      { value: 'codat', label: 'Codat' },
      { value: 'csv', label: 'Manual CSV upload' },
    ],
    CA: [
      { value: 'plaid', label: 'Plaid (Canada)' },
      { value: 'yodlee', label: 'Yodlee' },
      { value: 'codat', label: 'Codat' },
      { value: 'csv', label: 'Manual CSV upload' },
    ],
  };

  return providers[jurisdictionCode] || providers.GB;
}

/**
 * Validate step data against schema
 */
export async function validateStepData(
  _stepName: string,
  stepData: Record<string, unknown>,
  schema: OnboardingStepSchema
): Promise<{ valid: boolean; errors: Array<{ field: string; message: string }> }> {
  const errors: Array<{ field: string; message: string }> = [];

  // Check required fields
  for (const field of schema.fields) {
    if (field.required) {
      const value = stepData[field.name];
      if (value === undefined || value === null || value === '') {
        errors.push({ field: field.name, message: `${field.label} is required` });
        continue;
      }
    }

    const value = stepData[field.name];
    if (value === undefined || value === null || value === '') {
      continue; // Skip validation for empty optional fields
    }

    // Type-specific validation
    if (field.type === 'email' && typeof value === 'string') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        errors.push({ field: field.name, message: `${field.label} must be a valid email address` });
      }
    }

    if (field.type === 'text' && typeof value === 'string') {
      if (field.minLength && value.length < field.minLength) {
        errors.push({ field: field.name, message: `${field.label} must be at least ${field.minLength} characters` });
      }
      if (field.maxLength && value.length > field.maxLength) {
        errors.push({ field: field.name, message: `${field.label} must be at most ${field.maxLength} characters` });
      }
      if (field.regex && !new RegExp(field.regex).test(value)) {
        errors.push({ field: field.name, message: `${field.label} format is invalid` });
      }
    }

    if (field.type === 'number' && typeof value === 'number') {
      if (field.min !== undefined && value < field.min) {
        errors.push({ field: field.name, message: `${field.label} must be at least ${field.min}` });
      }
      if (field.max !== undefined && value > field.max) {
        errors.push({ field: field.name, message: `${field.label} must be at most ${field.max}` });
      }
    }
  }

  // Check validation rules
  for (const rule of schema.validationRules) {
    const value = stepData[rule.field];
    if (rule.type === 'required' && (value === undefined || value === null || value === '')) {
      errors.push({ field: rule.field, message: rule.message });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Save step data as draft
 */
export async function saveStepData(
  tenantId: TenantId,
  stepName: string,
  stepData: Record<string, unknown>
): Promise<void> {
  await db.query(
    `INSERT INTO onboarding_step_data (id, tenant_id, step_name, step_data, is_draft, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb, true, NOW(), NOW())
     ON CONFLICT (tenant_id, step_name) DO UPDATE
     SET step_data = $3::jsonb, is_draft = true, updated_at = NOW()`,
    [tenantId, stepName, JSON.stringify(stepData)]
  );
}
