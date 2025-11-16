import { createLogger } from '@ai-accountant/shared-utils';
import {
  TaxFilingSchema,
  TaxRegressionCase,
  TaxRule,
} from '@ai-accountant/shared-types';
import { InstallableTaxRulepack } from '../../../rules-engine/src/services/rulepackTypes';

const logger = createLogger('us-tax-system');

export interface USIncomeTaxBracket {
  min: number;
  max: number | null;
  rate: number;
}

export interface USStateTax {
  state: string;
  incomeTaxRate: number;
  salesTaxRate: number;
  hasLocalTax: boolean;
}

export type FilingStatus = 'single' | 'married' | 'head';

const FEDERAL_INCOME_TAX_BRACKETS_2024: Record<FilingStatus, USIncomeTaxBracket[]> = {
  single: [
    { min: 0, max: 11600, rate: 0.1 },
    { min: 11600, max: 47150, rate: 0.12 },
    { min: 47150, max: 100525, rate: 0.22 },
    { min: 100525, max: 191950, rate: 0.24 },
    { min: 191950, max: 243725, rate: 0.32 },
    { min: 243725, max: 609350, rate: 0.35 },
    { min: 609350, max: null, rate: 0.37 },
  ],
  married: [
    { min: 0, max: 23200, rate: 0.1 },
    { min: 23200, max: 94300, rate: 0.12 },
    { min: 94300, max: 201050, rate: 0.22 },
    { min: 201050, max: 383900, rate: 0.24 },
    { min: 383900, max: 487450, rate: 0.32 },
    { min: 487450, max: 731200, rate: 0.35 },
    { min: 731200, max: null, rate: 0.37 },
  ],
  head: [
    { min: 0, max: 16550, rate: 0.1 },
    { min: 16550, max: 63100, rate: 0.12 },
    { min: 63100, max: 100500, rate: 0.22 },
    { min: 100500, max: 191950, rate: 0.24 },
    { min: 191950, max: 243700, rate: 0.32 },
    { min: 243700, max: 609350, rate: 0.35 },
    { min: 609350, max: null, rate: 0.37 },
  ],
};

const FEDERAL_STANDARD_DEDUCTIONS_2024: Record<FilingStatus, number> = {
  single: 14600,
  married: 29200,
  head: 21900,
};

const CALIFORNIA_INCOME_TAX_BRACKETS_2024: USIncomeTaxBracket[] = [
  { min: 0, max: 10412, rate: 0.01 },
  { min: 10412, max: 24684, rate: 0.02 },
  { min: 24684, max: 38959, rate: 0.04 },
  { min: 38959, max: 54081, rate: 0.06 },
  { min: 54081, max: 68350, rate: 0.08 },
  { min: 68350, max: 349137, rate: 0.093 },
  { min: 349137, max: 418961, rate: 0.103 },
  { min: 418961, max: 698271, rate: 0.113 },
  { min: 698271, max: null, rate: 0.123 },
];

const CALIFORNIA_STANDARD_DEDUCTION_2024: Record<FilingStatus, number> = {
  single: 5202,
  married: 10404,
  head: 10404,
};

const FEDERAL_RULES: TaxRule[] = [
  {
    id: 'us-federal-income-2024',
    name: 'US Federal Income Tax 2024',
    description: 'Progressive income tax for ordinary income with 2024 brackets',
    condition: "transactionType === 'income'",
    action: 'applyProgressiveBrackets',
    priority: 1,
    isDeterministic: true,
  },
  {
    id: 'us-federal-payroll-2024',
    name: 'US Federal Payroll Tax 2024',
    description: 'FICA & Medicare baseline contributions',
    condition: "transactionType === 'payroll'",
    action: 'applyPayrollBaseline',
    priority: 2,
    isDeterministic: true,
  },
];

const FEDERAL_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'Form 1040',
    jurisdictionCode: 'US',
    description: 'Individual Income Tax Return',
    frequency: 'annual',
    method: 'efile',
    dueDaysAfterPeriod: 105,
    boxes: [
      { id: '1', label: 'Wages, salaries, tips', calculation: 'amount' },
      { id: '15', label: 'Taxable income', calculation: 'taxableIncome' },
      { id: '16', label: 'Total tax', calculation: 'taxAmount' },
    ],
    attachments: ['W-2', '1099'],
  },
  {
    form: 'Form 941',
    jurisdictionCode: 'US',
    description: 'Employer’s Quarterly Federal Tax Return',
    frequency: 'quarterly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Number of employees', calculation: 'context.employees' },
      { id: '2', label: 'Wages paid', calculation: 'amount' },
      { id: '5d', label: 'Total taxes after adjustments', calculation: 'taxAmount' },
    ],
  },
];

const FEDERAL_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'us-federal-income-single-95000',
    description: 'Single filer with $95k wages',
    transaction: {
      amount: 95000,
      type: 'income',
      filingStatus: 'single',
    },
    expected: {
      taxAmount: 12741,
      taxRate: 0.1341,
      filingBoxes: {
        '1': 95000,
        '15': 80400,
        '16': 12741,
      },
    },
  },
  {
    id: 'us-federal-income-married-180k',
    description: 'Married joint income $180k with $5k deductions',
    transaction: {
      amount: 180000,
      type: 'income',
      filingStatus: 'married',
      deductions: 5000,
    },
    expected: {
      taxAmount: 22182,
      taxRate: 0.1232,
      filingBoxes: {
        '1': 180000,
        '15': 145800,
        '16': 22182,
      },
    },
  },
];

const CALIFORNIA_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'Form 540',
    jurisdictionCode: 'US-CA',
    description: 'California Resident Income Tax Return',
    frequency: 'annual',
    method: 'efile',
    boxes: [
      { id: '11', label: 'Taxable income', calculation: 'taxableIncome' },
      { id: '31', label: 'Total tax', calculation: 'taxAmount' },
    ],
  },
  {
    form: 'BOE-401-A2',
    jurisdictionCode: 'US-CA',
    description: 'California Sales and Use Tax Return',
    frequency: 'quarterly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Total taxable sales', calculation: 'amount' },
      { id: '2', label: 'Total tax', calculation: 'taxAmount' },
    ],
  },
];

const CALIFORNIA_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'us-ca-sales-losangeles-10k',
    description: 'Los Angeles retail sale $10k',
    transaction: {
      amount: 10000,
      type: 'sale',
      metadata: { locality: 'LA' },
    },
    expected: {
      taxAmount: 975,
      taxRate: 0.0975,
      filingBoxes: {
        '1': 10000,
        '2': 975,
      },
    },
  },
  {
    id: 'us-ca-income-head-150k',
    description: 'Head of household $150k California income',
    transaction: {
      amount: 150000,
      type: 'income',
      filingStatus: 'head',
    },
    expected: {
      taxAmount: 9635.28,
      taxRate: 0.0642,
      filingBoxes: {
        '11': 139596,
        '31': 9635.28,
      },
    },
  },
];

const US_FEDERAL_RULEPACK_2024: InstallableTaxRulepack = {
  id: 'us-federal-2024-v1',
  country: 'US',
  jurisdictionCode: 'US',
  region: 'NA',
  year: 2024,
  version: '2024.1',
  rules: FEDERAL_RULES,
  filingTypes: ['income_tax', 'payroll'],
  status: 'active',
  metadata: {
    incomeTax: {
      brackets: FEDERAL_INCOME_TAX_BRACKETS_2024,
      standardDeductions: FEDERAL_STANDARD_DEDUCTIONS_2024,
    },
    payroll: {
      socialSecurityRate: 0.062,
      medicareRate: 0.0145,
      additionalMedicareRate: 0.009,
      wageBase: 168600,
    },
  },
  nexusThresholds: [
    { type: 'revenue', amount: 100000, currency: 'USD', period: 'annual', description: 'Remote seller revenue threshold' },
    { type: 'transactions', transactions: 200, description: 'Remote seller transaction threshold' },
  ],
  filingSchemas: FEDERAL_FILING_SCHEMAS,
  regressionTests: FEDERAL_REGRESSION_TESTS,
  effectiveFrom: new Date('2024-01-01'),
  isActive: true,
};

const CALIFORNIA_RULEPACK_2024: InstallableTaxRulepack = {
  id: 'us-ca-2024-v1',
  country: 'US',
  jurisdictionCode: 'US-CA',
  region: 'NA',
  year: 2024,
  version: '2024.1',
  rules: [
    {
      id: 'us-ca-income-2024',
      name: 'California Income Tax 2024',
      description: 'Progressive CA income tax for residents',
      condition: "transactionType === 'income'",
      action: 'applyProgressiveBrackets',
      priority: 1,
      isDeterministic: true,
    },
    {
      id: 'us-ca-sales-2024',
      name: 'California Sales Tax 2024',
      description: 'Statewide sales and optional district tax',
      condition: "transactionType === 'sale'",
      action: 'applySalesTax',
      priority: 2,
      isDeterministic: true,
    },
  ] as TaxRule[],
  filingTypes: ['income_tax', 'sales_tax'],
  status: 'active',
  metadata: {
    incomeTax: {
      brackets: CALIFORNIA_INCOME_TAX_BRACKETS_2024,
      standardDeductions: CALIFORNIA_STANDARD_DEDUCTION_2024,
    },
    salesTax: {
      baseRate: 0.0725,
      localRates: {
        LA: 0.025,
        SF: 0.0125,
        SD: 0.01,
      },
      reducedCategories: ['groceries', 'prescription_medication'],
    },
  },
  nexusThresholds: [
    { type: 'revenue', amount: 500000, currency: 'USD', period: 'rolling12', description: 'CA remote seller revenue threshold' },
    { type: 'transactions', transactions: 200, description: 'CA remote seller transaction threshold' },
  ],
  filingSchemas: CALIFORNIA_FILING_SCHEMAS,
  regressionTests: CALIFORNIA_REGRESSION_TESTS,
  effectiveFrom: new Date('2024-01-01'),
  isActive: true,
};

export function getBuiltInUSRulepacks(): InstallableTaxRulepack[] {
  // Import all state rulepacks
  const { getAllUSStateRulepacks } = require('./usStatesTaxSystem');
  const allStateRulepacks = getAllUSStateRulepacks();
  // Remove California from state list since it's already included
  const otherStateRulepacks = allStateRulepacks.filter(pack => pack.jurisdictionCode !== 'US-CA');
  return [US_FEDERAL_RULEPACK_2024, CALIFORNIA_RULEPACK_2024, ...otherStateRulepacks];
}

export function calculateUSFederalIncomeTax(
  income: number,
  filingStatus: FilingStatus = 'single',
  deductions = 0
): { tax: number; taxableIncome: number } {
  const standard = FEDERAL_STANDARD_DEDUCTIONS_2024[filingStatus] ?? 0;
  const taxableIncome = Math.max(0, income - standard - deductions);
  let remaining = taxableIncome;
  let tax = 0;
  let lowerBound = 0;

  const brackets = FEDERAL_INCOME_TAX_BRACKETS_2024[filingStatus] ?? FEDERAL_INCOME_TAX_BRACKETS_2024.single;

  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const upperBound = bracket.max ?? Number.MAX_SAFE_INTEGER;
    const span = Math.min(remaining, upperBound - lowerBound);
    if (span > 0) {
      tax += span * bracket.rate;
      remaining -= span;
    }
    lowerBound = upperBound;
  }

  return {
    tax: roundToCents(tax),
    taxableIncome: roundToCents(taxableIncome),
  };
}

export function calculateUSStateIncomeTax(
  income: number,
  stateCode: string,
  filingStatus: FilingStatus = 'single',
  deductions = 0
): { tax: number; taxableIncome: number } {
  if (stateCode.toUpperCase() !== 'CA') {
    const flatState = STATE_TAX_RATES[stateCode.toUpperCase()];
    const taxableIncome = Math.max(0, income - deductions);
    const tax = flatState ? taxableIncome * flatState.incomeTaxRate : 0;
    return { tax: roundToCents(tax), taxableIncome: roundToCents(taxableIncome) };
  }

  const standard = CALIFORNIA_STANDARD_DEDUCTION_2024[filingStatus] ?? 0;
  const taxableIncome = Math.max(0, income - standard - deductions);
  let remaining = taxableIncome;
  let tax = 0;
  let lowerBound = 0;

  for (const bracket of CALIFORNIA_INCOME_TAX_BRACKETS_2024) {
    if (remaining <= 0) break;
    const upperBound = bracket.max ?? Number.MAX_SAFE_INTEGER;
    const span = Math.min(remaining, upperBound - lowerBound);
    if (span > 0) {
      tax += span * bracket.rate;
      remaining -= span;
    }
    lowerBound = upperBound;
  }

  return { tax: roundToCents(tax), taxableIncome: roundToCents(taxableIncome) };
}

export function calculateUSSalesTax(
  amount: number,
  stateCode: string,
  locality?: string
): { tax: number; rate: number } {
  const state = STATE_TAX_RATES[stateCode.toUpperCase()];
  if (!state) {
    logger.warn(`Unknown state code: ${stateCode}`);
    return { tax: 0, rate: 0 };
  }
  let rate = state.salesTaxRate;
  if (stateCode.toUpperCase() === 'CA' && locality) {
    const localRate =
      (CALIFORNIA_RULEPACK_2024.metadata?.salesTax as { baseRate: number; localRates: Record<string, number> })?.localRates?.[
        locality
      ];
    if (localRate) {
      rate += localRate;
    }
  }

  return { tax: roundToCents(amount * rate), rate: roundToFour(rate) };
}

export function getUSStateTaxInfo(stateCode: string): USStateTax | null {
  return STATE_TAX_RATES[stateCode.toUpperCase()] || null;
}

export function calculateUSTotalTax(
  income: number,
  stateCode: string,
  filingStatus: FilingStatus = 'single',
  localIncomeTaxRate = 0
): {
  federalIncomeTax: number;
  stateIncomeTax: number;
  localIncomeTax: number;
  totalIncomeTax: number;
} {
  const federal = calculateUSFederalIncomeTax(income, filingStatus);
  const state = calculateUSStateIncomeTax(income, stateCode, filingStatus);
  const localIncomeTax = roundToCents(Math.max(0, income) * localIncomeTaxRate);

  return {
    federalIncomeTax: federal.tax,
    stateIncomeTax: state.tax,
    localIncomeTax,
    totalIncomeTax: roundToCents(federal.tax + state.tax + localIncomeTax),
  };
}

const STATE_TAX_RATES: Record<string, USStateTax> = {
  CA: { state: 'California', incomeTaxRate: 0.093, salesTaxRate: 0.0725, hasLocalTax: true },
  NY: { state: 'New York', incomeTaxRate: 0.0641, salesTaxRate: 0.04, hasLocalTax: true },
  TX: { state: 'Texas', incomeTaxRate: 0, salesTaxRate: 0.0625, hasLocalTax: true },
  FL: { state: 'Florida', incomeTaxRate: 0, salesTaxRate: 0.06, hasLocalTax: true },
  IL: { state: 'Illinois', incomeTaxRate: 0.0495, salesTaxRate: 0.0625, hasLocalTax: true },
  PA: { state: 'Pennsylvania', incomeTaxRate: 0.0307, salesTaxRate: 0.06, hasLocalTax: true },
  OH: { state: 'Ohio', incomeTaxRate: 0.0399, salesTaxRate: 0.0575, hasLocalTax: true },
  GA: { state: 'Georgia', incomeTaxRate: 0.0575, salesTaxRate: 0.04, hasLocalTax: true },
  NC: { state: 'North Carolina', incomeTaxRate: 0.0475, salesTaxRate: 0.0475, hasLocalTax: true },
  MI: { state: 'Michigan', incomeTaxRate: 0.0425, salesTaxRate: 0.06, hasLocalTax: true },
};

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundToFour(value: number): number {
  return Math.round(value * 10000) / 10000;
}
