import {
  TaxFilingSchema,
  TaxRegressionCase,
  TaxRule,
} from '@ai-accountant/shared-types';
import { InstallableTaxRulepack } from '../../../rules-engine/src/services/rulepackTypes';

export interface CanadaIncomeTaxBracket {
  min: number;
  max: number | null;
  rate: number;
}

export type CanadaFilingStatus = 'single' | 'married' | 'common_law';

// Federal Canada Tax Brackets 2024
const CANADA_FEDERAL_INCOME_BRACKETS_2024: Record<CanadaFilingStatus, CanadaIncomeTaxBracket[]> = {
  single: [
    { min: 0, max: 55867, rate: 0.15 },
    { min: 55867, max: 111733, rate: 0.205 },
    { min: 111733, max: 173205, rate: 0.26 },
    { min: 173205, max: 246752, rate: 0.29 },
    { min: 246752, max: null, rate: 0.33 },
  ],
  married: [
    { min: 0, max: 55867, rate: 0.15 },
    { min: 55867, max: 111733, rate: 0.205 },
    { min: 111733, max: 173205, rate: 0.26 },
    { min: 173205, max: 246752, rate: 0.29 },
    { min: 246752, max: null, rate: 0.33 },
  ],
  common_law: [
    { min: 0, max: 55867, rate: 0.15 },
    { min: 55867, max: 111733, rate: 0.205 },
    { min: 111733, max: 173205, rate: 0.26 },
    { min: 173205, max: 246752, rate: 0.29 },
    { min: 246752, max: null, rate: 0.33 },
  ],
};

const CANADA_FEDERAL_BASIC_PERSONAL_AMOUNT_2024 = 15705;

const CANADA_FEDERAL_RULES: TaxRule[] = [
  {
    id: 'ca-federal-income-2024',
    name: 'Canada Federal Income Tax 2024',
    description: 'Progressive federal income tax with 2024 brackets',
    condition: "transactionType === 'income'",
    action: 'applyProgressiveBrackets',
    priority: 1,
    isDeterministic: true,
  },
  {
    id: 'ca-federal-gst-2024',
    name: 'Canada GST 2024',
    description: 'Goods and Services Tax (GST)',
    condition: "transactionType === 'sale'",
    action: 'applyGST',
    priority: 2,
    isDeterministic: true,
  },
];

const CANADA_FEDERAL_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'T1',
    jurisdictionCode: 'CA',
    description: 'Canada Individual Income Tax Return',
    frequency: 'annual',
    method: 'efile',
    dueDaysAfterPeriod: 105,
    boxes: [
      { id: '150', label: 'Total income', calculation: 'amount' },
      { id: '260', label: 'Taxable income', calculation: 'taxableIncome' },
      { id: '435', label: 'Total federal tax', calculation: 'taxAmount' },
    ],
    attachments: ['T4', 'T5'],
  },
  {
    form: 'GST34',
    jurisdictionCode: 'CA',
    description: 'GST/HST Return',
    frequency: 'quarterly',
    method: 'efile',
    boxes: [
      { id: '101', label: 'Total sales', calculation: 'amount' },
      { id: '105', label: 'GST/HST collected', calculation: 'taxAmount' },
      { id: '108', label: 'GST/HST paid', calculation: 'context.inputTax' },
      { id: '109', label: 'Net tax', calculation: 'taxAmount' },
    ],
  },
];

const CANADA_FEDERAL_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'ca-federal-income-single-80000',
    description: 'Single filer $80k CAD income',
    transaction: {
      amount: 80000,
      type: 'income',
      filingStatus: 'single',
    },
    expected: {
      taxAmount: 12000,
      taxRate: 0.15,
      filingBoxes: {
        '150': 80000,
        '260': 64495,
        '435': 12000,
      },
    },
  },
  {
    id: 'ca-federal-gst-10000',
    description: 'GST on $10k sale',
    transaction: {
      amount: 10000,
      type: 'sale',
    },
    expected: {
      taxAmount: 500,
      taxRate: 0.05,
      filingBoxes: {
        '101': 10000,
        '105': 500,
        '109': 500,
      },
    },
  },
];

const CANADA_FEDERAL_RULEPACK_2024: InstallableTaxRulepack = {
  id: 'ca-federal-2024-v1',
  country: 'CA',
  jurisdictionCode: 'CA',
  region: 'NA',
  year: 2024,
  version: '2024.1',
  rules: CANADA_FEDERAL_RULES,
  filingTypes: ['income_tax', 'gst'],
  status: 'active',
  metadata: {
    incomeTax: {
      brackets: CANADA_FEDERAL_INCOME_BRACKETS_2024,
      basicPersonalAmount: CANADA_FEDERAL_BASIC_PERSONAL_AMOUNT_2024,
    },
    gst: {
      rate: 0.05,
      appliesTo: 'all',
    },
  },
  nexusThresholds: [
    { type: 'revenue', amount: 30000, currency: 'CAD', period: 'annual', description: 'GST registration threshold' },
  ],
  filingSchemas: CANADA_FEDERAL_FILING_SCHEMAS,
  regressionTests: CANADA_FEDERAL_REGRESSION_TESTS,
  effectiveFrom: new Date('2024-01-01'),
  isActive: true,
};

// Ontario
const ONTARIO_INCOME_BRACKETS_2024: Record<CanadaFilingStatus, CanadaIncomeTaxBracket[]> = {
  single: [
    { min: 0, max: 51446, rate: 0.0505 },
    { min: 51446, max: 102894, rate: 0.0915 },
    { min: 102894, max: 150000, rate: 0.1116 },
    { min: 150000, max: 220000, rate: 0.1216 },
    { min: 220000, max: null, rate: 0.1316 },
  ],
  married: [
    { min: 0, max: 51446, rate: 0.0505 },
    { min: 51446, max: 102894, rate: 0.0915 },
    { min: 102894, max: 150000, rate: 0.1116 },
    { min: 150000, max: 220000, rate: 0.1216 },
    { min: 220000, max: null, rate: 0.1316 },
  ],
  common_law: [
    { min: 0, max: 51446, rate: 0.0505 },
    { min: 51446, max: 102894, rate: 0.0915 },
    { min: 102894, max: 150000, rate: 0.1116 },
    { min: 150000, max: 220000, rate: 0.1216 },
    { min: 220000, max: null, rate: 0.1316 },
  ],
};

const ONTARIO_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'ON428',
    jurisdictionCode: 'CA-ON',
    description: 'Ontario Tax',
    frequency: 'annual',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Ontario taxable income', calculation: 'taxableIncome' },
      { id: '2', label: 'Ontario tax', calculation: 'taxAmount' },
    ],
  },
];

const ONTARIO_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'ca-on-income-single-75000',
    description: 'Single filer $75k CAD Ontario income',
    transaction: {
      amount: 75000,
      type: 'income',
      filingStatus: 'single',
    },
    expected: {
      taxAmount: 3787.5,
      taxRate: 0.0505,
      filingBoxes: {
        '1': 75000,
        '2': 3787.5,
      },
    },
  },
];

const ONTARIO_RULEPACK_2024: InstallableTaxRulepack = {
  id: 'ca-on-2024-v1',
  country: 'CA',
  jurisdictionCode: 'CA-ON',
  region: 'NA',
  year: 2024,
  version: '2024.1',
  rules: [
    {
      id: 'ca-on-income-2024',
      name: 'Ontario Income Tax 2024',
      description: 'Progressive Ontario income tax',
      condition: "transactionType === 'income'",
      action: 'applyProgressiveBrackets',
      priority: 1,
      isDeterministic: true,
    },
    {
      id: 'ca-on-hst-2024',
      name: 'Ontario HST 2024',
      description: 'Harmonized Sales Tax (HST)',
      condition: "transactionType === 'sale'",
      action: 'applyHST',
      priority: 2,
      isDeterministic: true,
    },
  ],
  filingTypes: ['income_tax', 'hst'],
  status: 'active',
  metadata: {
    incomeTax: {
      brackets: ONTARIO_INCOME_BRACKETS_2024,
    },
    hst: {
      rate: 0.13,
      gstComponent: 0.05,
      pstComponent: 0.08,
    },
  },
  nexusThresholds: [
    { type: 'revenue', amount: 30000, currency: 'CAD', period: 'annual', description: 'HST registration threshold' },
  ],
  filingSchemas: ONTARIO_FILING_SCHEMAS,
  regressionTests: ONTARIO_REGRESSION_TESTS,
  effectiveFrom: new Date('2024-01-01'),
  isActive: true,
};

// Quebec
const QUEBEC_INCOME_BRACKETS_2024: Record<CanadaFilingStatus, CanadaIncomeTaxBracket[]> = {
  single: [
    { min: 0, max: 51480, rate: 0.14 },
    { min: 51480, max: 103545, rate: 0.19 },
    { min: 103545, max: 126000, rate: 0.24 },
    { min: 126000, max: null, rate: 0.2575 },
  ],
  married: [
    { min: 0, max: 51480, rate: 0.14 },
    { min: 51480, max: 103545, rate: 0.19 },
    { min: 103545, max: 126000, rate: 0.24 },
    { min: 126000, max: null, rate: 0.2575 },
  ],
  common_law: [
    { min: 0, max: 51480, rate: 0.14 },
    { min: 51480, max: 103545, rate: 0.19 },
    { min: 103545, max: 126000, rate: 0.24 },
    { min: 126000, max: null, rate: 0.2575 },
  ],
};

const QUEBEC_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'TP-1',
    jurisdictionCode: 'CA-QC',
    description: 'Quebec Income Tax Return',
    frequency: 'annual',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Quebec taxable income', calculation: 'taxableIncome' },
      { id: '2', label: 'Quebec tax', calculation: 'taxAmount' },
    ],
  },
  {
    form: 'GST-34',
    jurisdictionCode: 'CA-QC',
    description: 'GST/QST Return',
    frequency: 'quarterly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Total sales', calculation: 'amount' },
      { id: '2', label: 'GST collected', calculation: 'context.gst' },
      { id: '3', label: 'QST collected', calculation: 'taxAmount' },
    ],
  },
];

const QUEBEC_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'ca-qc-income-single-70000',
    description: 'Single filer $70k CAD Quebec income',
    transaction: {
      amount: 70000,
      type: 'income',
      filingStatus: 'single',
    },
    expected: {
      taxAmount: 9800,
      taxRate: 0.14,
      filingBoxes: {
        '1': 70000,
        '2': 9800,
      },
    },
  },
];

const QUEBEC_RULEPACK_2024: InstallableTaxRulepack = {
  id: 'ca-qc-2024-v1',
  country: 'CA',
  jurisdictionCode: 'CA-QC',
  region: 'NA',
  year: 2024,
  version: '2024.1',
  rules: [
    {
      id: 'ca-qc-income-2024',
      name: 'Quebec Income Tax 2024',
      description: 'Progressive Quebec income tax',
      condition: "transactionType === 'income'",
      action: 'applyProgressiveBrackets',
      priority: 1,
      isDeterministic: true,
    },
    {
      id: 'ca-qc-qst-2024',
      name: 'Quebec Sales Tax (QST) 2024',
      description: 'Quebec Sales Tax',
      condition: "transactionType === 'sale'",
      action: 'applyQST',
      priority: 2,
      isDeterministic: true,
    },
  ],
  filingTypes: ['income_tax', 'qst'],
  status: 'active',
  metadata: {
    incomeTax: {
      brackets: QUEBEC_INCOME_BRACKETS_2024,
    },
    qst: {
      rate: 0.09975,
    },
    gst: {
      rate: 0.05,
    },
  },
  nexusThresholds: [
    { type: 'revenue', amount: 30000, currency: 'CAD', period: 'annual', description: 'QST registration threshold' },
  ],
  filingSchemas: QUEBEC_FILING_SCHEMAS,
  regressionTests: QUEBEC_REGRESSION_TESTS,
  effectiveFrom: new Date('2024-01-01'),
  isActive: true,
};

// Helper function to create province rulepack
function createProvinceRulepack(
  provinceCode: string,
  provinceName: string,
  incomeBrackets: Record<CanadaFilingStatus, CanadaIncomeTaxBracket[]> | null,
  incomeTaxRate: number,
  pstRate: number,
  hasHST: boolean,
  hstRate: number,
  filingSchemas: TaxFilingSchema[],
  regressionTests: TaxRegressionCase[]
): InstallableTaxRulepack {
  const rules: TaxRule[] = [];
  
  if (incomeBrackets || incomeTaxRate > 0) {
    rules.push({
      id: `ca-${provinceCode.toLowerCase()}-income-2024`,
      name: `${provinceName} Income Tax 2024`,
      description: incomeBrackets ? `Progressive ${provinceName} income tax` : `${provinceName} income tax`,
      condition: "transactionType === 'income'",
      action: incomeBrackets ? 'applyProgressiveBrackets' : 'applyFlatRate',
      priority: 1,
      isDeterministic: true,
    });
  }
  
  if (hasHST) {
    rules.push({
      id: `ca-${provinceCode.toLowerCase()}-hst-2024`,
      name: `${provinceName} HST 2024`,
      description: 'Harmonized Sales Tax',
      condition: "transactionType === 'sale'",
      action: 'applyHST',
      priority: 2,
      isDeterministic: true,
    });
  } else if (pstRate > 0) {
    rules.push({
      id: `ca-${provinceCode.toLowerCase()}-pst-2024`,
      name: `${provinceName} PST 2024`,
      description: 'Provincial Sales Tax',
      condition: "transactionType === 'sale'",
      action: 'applyPST',
      priority: 2,
      isDeterministic: true,
    });
  }

  const metadata: Record<string, unknown> = {};
  if (incomeBrackets || incomeTaxRate > 0) {
    metadata.incomeTax = incomeBrackets
      ? { brackets: incomeBrackets }
      : { flatRate: incomeTaxRate };
  }
  if (hasHST) {
    metadata.hst = { rate: hstRate, gstComponent: 0.05, pstComponent: hstRate - 0.05 };
  } else if (pstRate > 0) {
    metadata.pst = { rate: pstRate };
    metadata.gst = { rate: 0.05 };
  }

  return {
    id: `ca-${provinceCode.toLowerCase()}-2024-v1`,
    country: 'CA',
    jurisdictionCode: `CA-${provinceCode}`,
    region: 'NA',
    year: 2024,
    version: '2024.1',
    rules,
    filingTypes: incomeTaxRate > 0 ? ['income_tax', hasHST ? 'hst' : 'pst'] : [hasHST ? 'hst' : 'pst'],
    status: 'active',
    metadata,
    nexusThresholds: [
      { type: 'revenue', amount: 30000, currency: 'CAD', period: 'annual', description: `${provinceName} sales tax registration threshold` },
    ],
    filingSchemas,
    regressionTests,
    effectiveFrom: new Date('2024-01-01'),
    isActive: true,
  };
}

// Remaining provinces
const PROVINCES = [
  { code: 'AB', name: 'Alberta', incomeTax: 0.10, pst: 0, hasHST: false, hst: 0 },
  { code: 'BC', name: 'British Columbia', incomeTax: 0.0506, pst: 0.07, hasHST: false, hst: 0 },
  { code: 'MB', name: 'Manitoba', incomeTax: 0.108, pst: 0.07, hasHST: false, hst: 0 },
  { code: 'NB', name: 'New Brunswick', incomeTax: 0.094, pst: 0, hasHST: true, hst: 0.15 },
  { code: 'NL', name: 'Newfoundland and Labrador', incomeTax: 0.087, pst: 0, hasHST: true, hst: 0.15 },
  { code: 'NS', name: 'Nova Scotia', incomeTax: 0.0875, pst: 0, hasHST: true, hst: 0.15 },
  { code: 'PE', name: 'Prince Edward Island', incomeTax: 0.098, pst: 0, hasHST: true, hst: 0.15 },
  { code: 'SK', name: 'Saskatchewan', incomeTax: 0.105, pst: 0.06, hasHST: false, hst: 0 },
  { code: 'NT', name: 'Northwest Territories', incomeTax: 0.059, pst: 0, hasHST: false, hst: 0 },
  { code: 'NU', name: 'Nunavut', incomeTax: 0.04, pst: 0, hasHST: false, hst: 0 },
  { code: 'YT', name: 'Yukon', incomeTax: 0.064, pst: 0, hasHST: false, hst: 0 },
];

const PROVINCE_RULEPACKS = PROVINCES.map(province => {
  const filingSchemas: TaxFilingSchema[] = [
    {
      form: `CA-${province.code}-428`,
      jurisdictionCode: `CA-${province.code}`,
      description: `${province.name} Tax`,
      frequency: 'annual',
      method: 'efile',
      boxes: [
        { id: '1', label: 'Taxable income', calculation: 'taxableIncome' },
        { id: '2', label: 'Provincial tax', calculation: 'taxAmount' },
      ],
    },
  ];

  if (province.hasHST || province.pst > 0) {
    filingSchemas.push({
      form: province.hasHST ? 'GST34' : `CA-${province.code}-ST`,
      jurisdictionCode: `CA-${province.code}`,
      description: province.hasHST ? 'HST Return' : `${province.name} PST Return`,
      frequency: 'quarterly',
      method: 'efile',
      boxes: [
        { id: '1', label: 'Total sales', calculation: 'amount' },
        { id: '2', label: 'Tax due', calculation: 'taxAmount' },
      ],
    });
  }

  return createProvinceRulepack(
    province.code,
    province.name,
    null,
    province.incomeTax,
    province.pst,
    province.hasHST,
    province.hst,
    filingSchemas,
    []
  );
});

export function getBuiltInCanadaRulepacks(): InstallableTaxRulepack[] {
  return [
    CANADA_FEDERAL_RULEPACK_2024,
    ONTARIO_RULEPACK_2024,
    QUEBEC_RULEPACK_2024,
    ...PROVINCE_RULEPACKS,
  ];
}
