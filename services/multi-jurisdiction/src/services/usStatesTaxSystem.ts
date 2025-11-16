import {
  TaxFilingSchema,
  TaxRegressionCase,
  TaxRule,
} from '@ai-accountant/shared-types';
import { InstallableTaxRulepack } from '../../../rules-engine/src/services/rulepackTypes';
import { USIncomeTaxBracket, FilingStatus } from './usTaxSystem';

// Helper function to create state rulepack
function createStateRulepack(
  stateCode: string,
  stateName: string,
  incomeBrackets: Record<FilingStatus, USIncomeTaxBracket[]> | USIncomeTaxBracket[] | null,
  standardDeductions: Record<FilingStatus, number> | null,
  incomeTaxRate: number,
  salesTaxRate: number,
  hasLocalTax: boolean,
  filingSchemas: TaxFilingSchema[],
  regressionTests: TaxRegressionCase[],
  nexusThresholds: Array<{ type: 'revenue' | 'transactions'; amount?: number; transactions?: number; currency?: string; period?: string; description?: string }>
): InstallableTaxRulepack {
  const isProgressive = Array.isArray(incomeBrackets) || (incomeBrackets && typeof incomeBrackets === 'object' && !Array.isArray(incomeBrackets));
  
  const rules: TaxRule[] = [];
  if (incomeTaxRate > 0 || isProgressive) {
    rules.push({
      id: `us-${stateCode.toLowerCase()}-income-2024`,
      name: `${stateName} Income Tax 2024`,
      description: isProgressive ? `Progressive ${stateName} income tax for residents` : `Flat ${stateName} income tax`,
      condition: "transactionType === 'income'",
      action: isProgressive ? 'applyProgressiveBrackets' : 'applyFlatRate',
      priority: 1,
      isDeterministic: true,
    });
  }
  
  if (salesTaxRate > 0) {
    rules.push({
      id: `us-${stateCode.toLowerCase()}-sales-2024`,
      name: `${stateName} Sales Tax 2024`,
      description: `${stateName} sales and use tax`,
      condition: "transactionType === 'sale'",
      action: 'applySalesTax',
      priority: 2,
      isDeterministic: true,
    });
  }

  const metadata: Record<string, unknown> = {};
  if (incomeTaxRate > 0 || isProgressive) {
    metadata.incomeTax = isProgressive
      ? { brackets: incomeBrackets, standardDeductions: standardDeductions || {} }
      : { flatRate: incomeTaxRate, standardDeductions: standardDeductions || {} };
  }
  if (salesTaxRate > 0) {
    metadata.salesTax = { baseRate: salesTaxRate, hasLocalTax };
  }

  return {
    id: `us-${stateCode.toLowerCase()}-2024-v1`,
    country: 'US',
    jurisdictionCode: `US-${stateCode}`,
    region: 'NA',
    year: 2024,
    version: '2024.1',
    rules,
    filingTypes: incomeTaxRate > 0 ? ['income_tax', 'sales_tax'] : ['sales_tax'],
    status: 'active',
    metadata,
    nexusThresholds,
    filingSchemas,
    regressionTests,
    effectiveFrom: new Date('2024-01-01'),
    isActive: true,
  };
}

// New York State
const NEW_YORK_INCOME_BRACKETS_2024: Record<FilingStatus, USIncomeTaxBracket[]> = {
  single: [
    { min: 0, max: 8500, rate: 0.04 },
    { min: 8500, max: 11700, rate: 0.045 },
    { min: 11700, max: 13900, rate: 0.0525 },
    { min: 13900, max: 80650, rate: 0.0585 },
    { min: 80650, max: 215400, rate: 0.0625 },
    { min: 215400, max: 1077550, rate: 0.0685 },
    { min: 1077550, max: null, rate: 0.109 },
  ],
  married: [
    { min: 0, max: 17150, rate: 0.04 },
    { min: 17150, max: 23600, rate: 0.045 },
    { min: 23600, max: 27900, rate: 0.0525 },
    { min: 27900, max: 161550, rate: 0.0585 },
    { min: 161550, max: 323200, rate: 0.0625 },
    { min: 323200, max: 2155350, rate: 0.0685 },
    { min: 2155350, max: null, rate: 0.109 },
  ],
  head: [
    { min: 0, max: 12800, rate: 0.04 },
    { min: 12800, max: 17650, rate: 0.045 },
    { min: 17650, max: 20950, rate: 0.0525 },
    { min: 20950, max: 107650, rate: 0.0585 },
    { min: 107650, max: 269300, rate: 0.0625 },
    { min: 269300, max: 1616450, rate: 0.0685 },
    { min: 1616450, max: null, rate: 0.109 },
  ],
};

const NEW_YORK_STANDARD_DEDUCTION_2024: Record<FilingStatus, number> = {
  single: 8000,
  married: 16050,
  head: 11250,
};

const NEW_YORK_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'Form IT-201',
    jurisdictionCode: 'US-NY',
    description: 'New York Resident Income Tax Return',
    frequency: 'annual',
    method: 'efile',
    dueDaysAfterPeriod: 105,
    boxes: [
      { id: '17', label: 'Federal adjusted gross income', calculation: 'amount' },
      { id: '22', label: 'New York taxable income', calculation: 'taxableIncome' },
      { id: '33', label: 'Total tax', calculation: 'taxAmount' },
    ],
  },
  {
    form: 'ST-100',
    jurisdictionCode: 'US-NY',
    description: 'New York Sales and Use Tax Return',
    frequency: 'quarterly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Total sales', calculation: 'amount' },
      { id: '2', label: 'Taxable sales', calculation: 'amount' },
      { id: '3', label: 'Tax due', calculation: 'taxAmount' },
    ],
  },
];

const NEW_YORK_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'us-ny-income-single-100k',
    description: 'Single filer $100k New York income',
    transaction: {
      amount: 100000,
      type: 'income',
      filingStatus: 'single',
    },
    expected: {
      taxAmount: 6401,
      taxRate: 0.064,
      filingBoxes: {
        '17': 100000,
        '22': 92000,
        '33': 6401,
      },
    },
  },
];

const NEW_YORK_RULEPACK = createStateRulepack(
  'NY',
  'New York',
  NEW_YORK_INCOME_BRACKETS_2024,
  NEW_YORK_STANDARD_DEDUCTION_2024,
  0.0641,
  0.04,
  true,
  NEW_YORK_FILING_SCHEMAS,
  NEW_YORK_REGRESSION_TESTS,
  [
    { type: 'revenue', amount: 500000, currency: 'USD', period: 'rolling12', description: 'NY remote seller threshold' },
    { type: 'transactions', transactions: 100, description: 'NY transaction threshold' },
  ]
);

// Texas (no income tax, sales tax only)
const TEXAS_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: '01-114',
    jurisdictionCode: 'US-TX',
    description: 'Texas Sales and Use Tax Return',
    frequency: 'monthly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Total sales', calculation: 'amount' },
      { id: '2', label: 'Taxable sales', calculation: 'amount' },
      { id: '3', label: 'Tax due', calculation: 'taxAmount' },
    ],
  },
];

const TEXAS_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'us-tx-sales-10k',
    description: 'Texas sale $10k',
    transaction: {
      amount: 10000,
      type: 'sale',
    },
    expected: {
      taxAmount: 625,
      taxRate: 0.0625,
      filingBoxes: {
        '1': 10000,
        '2': 10000,
        '3': 625,
      },
    },
  },
];

const TEXAS_RULEPACK = createStateRulepack(
  'TX',
  'Texas',
  null,
  null,
  0,
  0.0625,
  true,
  TEXAS_FILING_SCHEMAS,
  TEXAS_REGRESSION_TESTS,
  [
    { type: 'revenue', amount: 500000, currency: 'USD', period: 'annual', description: 'TX remote seller threshold' },
  ]
);

// Florida (no income tax, sales tax only)
const FLORIDA_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'DR-15',
    jurisdictionCode: 'US-FL',
    description: 'Florida Sales and Use Tax Return',
    frequency: 'monthly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Total sales', calculation: 'amount' },
      { id: '2', label: 'Taxable sales', calculation: 'amount' },
      { id: '3', label: 'Tax due', calculation: 'taxAmount' },
    ],
  },
];

const FLORIDA_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'us-fl-sales-10k',
    description: 'Florida sale $10k',
    transaction: {
      amount: 10000,
      type: 'sale',
    },
    expected: {
      taxAmount: 600,
      taxRate: 0.06,
      filingBoxes: {
        '1': 10000,
        '2': 10000,
        '3': 600,
      },
    },
  },
];

const FLORIDA_RULEPACK = createStateRulepack(
  'FL',
  'Florida',
  null,
  null,
  0,
  0.06,
  true,
  FLORIDA_FILING_SCHEMAS,
  FLORIDA_REGRESSION_TESTS,
  [
    { type: 'revenue', amount: 100000, currency: 'USD', period: 'annual', description: 'FL remote seller threshold' },
  ]
);

// Illinois
const ILLINOIS_INCOME_BRACKETS_2024: USIncomeTaxBracket[] = [
  { min: 0, max: null, rate: 0.0495 },
];

const ILLINOIS_STANDARD_DEDUCTION_2024: Record<FilingStatus, number> = {
  single: 2500,
  married: 5000,
  head: 2500,
};

const ILLINOIS_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'IL-1040',
    jurisdictionCode: 'US-IL',
    description: 'Illinois Individual Income Tax Return',
    frequency: 'annual',
    method: 'efile',
    dueDaysAfterPeriod: 105,
    boxes: [
      { id: '1', label: 'Federal AGI', calculation: 'amount' },
      { id: '15', label: 'Illinois taxable income', calculation: 'taxableIncome' },
      { id: '16', label: 'Total tax', calculation: 'taxAmount' },
    ],
  },
  {
    form: 'ST-1',
    jurisdictionCode: 'US-IL',
    description: 'Illinois Sales and Use Tax Return',
    frequency: 'monthly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Total sales', calculation: 'amount' },
      { id: '2', label: 'Tax due', calculation: 'taxAmount' },
    ],
  },
];

const ILLINOIS_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'us-il-income-single-80k',
    description: 'Single filer $80k Illinois income',
    transaction: {
      amount: 80000,
      type: 'income',
      filingStatus: 'single',
    },
    expected: {
      taxAmount: 3826.25,
      taxRate: 0.0478,
      filingBoxes: {
        '1': 80000,
        '15': 77500,
        '16': 3826.25,
      },
    },
  },
];

const ILLINOIS_RULEPACK = createStateRulepack(
  'IL',
  'Illinois',
  ILLINOIS_INCOME_BRACKETS_2024,
  ILLINOIS_STANDARD_DEDUCTION_2024,
  0.0495,
  0.0625,
  true,
  ILLINOIS_FILING_SCHEMAS,
  ILLINOIS_REGRESSION_TESTS,
  [
    { type: 'revenue', amount: 100000, currency: 'USD', period: 'annual', description: 'IL remote seller threshold' },
    { type: 'transactions', transactions: 200, description: 'IL transaction threshold' },
  ]
);

// Pennsylvania
const PENNSYLVANIA_INCOME_BRACKETS_2024: USIncomeTaxBracket[] = [
  { min: 0, max: null, rate: 0.0307 },
];

const PENNSYLVANIA_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'PA-40',
    jurisdictionCode: 'US-PA',
    description: 'Pennsylvania Personal Income Tax Return',
    frequency: 'annual',
    method: 'efile',
    dueDaysAfterPeriod: 105,
    boxes: [
      { id: '1', label: 'Total income', calculation: 'amount' },
      { id: '11', label: 'Taxable income', calculation: 'taxableIncome' },
      { id: '12', label: 'Total tax', calculation: 'taxAmount' },
    ],
  },
  {
    form: 'PA-3',
    jurisdictionCode: 'US-PA',
    description: 'Pennsylvania Sales and Use Tax Return',
    frequency: 'monthly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Total sales', calculation: 'amount' },
      { id: '2', label: 'Tax due', calculation: 'taxAmount' },
    ],
  },
];

const PENNSYLVANIA_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'us-pa-income-single-75k',
    description: 'Single filer $75k Pennsylvania income',
    transaction: {
      amount: 75000,
      type: 'income',
      filingStatus: 'single',
    },
    expected: {
      taxAmount: 2302.5,
      taxRate: 0.0307,
      filingBoxes: {
        '1': 75000,
        '11': 75000,
        '12': 2302.5,
      },
    },
  },
];

const PENNSYLVANIA_RULEPACK = createStateRulepack(
  'PA',
  'Pennsylvania',
  PENNSYLVANIA_INCOME_BRACKETS_2024,
  null,
  0.0307,
  0.06,
  true,
  PENNSYLVANIA_FILING_SCHEMAS,
  PENNSYLVANIA_REGRESSION_TESTS,
  [
    { type: 'revenue', amount: 100000, currency: 'USD', period: 'annual', description: 'PA remote seller threshold' },
  ]
);

// Ohio
const OHIO_INCOME_BRACKETS_2024: Record<FilingStatus, USIncomeTaxBracket[]> = {
  single: [
    { min: 0, max: 26050, rate: 0 },
    { min: 26050, max: 41700, rate: 0.025 },
    { min: 41700, max: 83350, rate: 0.035 },
    { min: 83350, max: 104250, rate: 0.0375 },
    { min: 104250, max: 208500, rate: 0.0399 },
    { min: 208500, max: null, rate: 0.0399 },
  ],
  married: [
    { min: 0, max: 52100, rate: 0 },
    { min: 52100, max: 83400, rate: 0.025 },
    { min: 83400, max: 166700, rate: 0.035 },
    { min: 166700, max: 208500, rate: 0.0375 },
    { min: 208500, max: 417000, rate: 0.0399 },
    { min: 417000, max: null, rate: 0.0399 },
  ],
  head: [
    { min: 0, max: 39075, rate: 0 },
    { min: 39075, max: 62550, rate: 0.025 },
    { min: 62550, max: 125100, rate: 0.035 },
    { min: 125100, max: 156375, rate: 0.0375 },
    { min: 156375, max: 312750, rate: 0.0399 },
    { min: 312750, max: null, rate: 0.0399 },
  ],
};

const OHIO_STANDARD_DEDUCTION_2024: Record<FilingStatus, number> = {
  single: 2600,
  married: 5200,
  head: 2600,
};

const OHIO_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'IT-1040',
    jurisdictionCode: 'US-OH',
    description: 'Ohio Individual Income Tax Return',
    frequency: 'annual',
    method: 'efile',
    dueDaysAfterPeriod: 105,
    boxes: [
      { id: '1', label: 'Federal AGI', calculation: 'amount' },
      { id: '15', label: 'Ohio taxable income', calculation: 'taxableIncome' },
      { id: '16', label: 'Total tax', calculation: 'taxAmount' },
    ],
  },
  {
    form: 'UT-1000',
    jurisdictionCode: 'US-OH',
    description: 'Ohio Sales and Use Tax Return',
    frequency: 'monthly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Total sales', calculation: 'amount' },
      { id: '2', label: 'Tax due', calculation: 'taxAmount' },
    ],
  },
];

const OHIO_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'us-oh-income-single-70k',
    description: 'Single filer $70k Ohio income',
    transaction: {
      amount: 70000,
      type: 'income',
      filingStatus: 'single',
    },
    expected: {
      taxAmount: 2790.5,
      taxRate: 0.0399,
      filingBoxes: {
        '1': 70000,
        '15': 67400,
        '16': 2790.5,
      },
    },
  },
];

const OHIO_RULEPACK = createStateRulepack(
  'OH',
  'Ohio',
  OHIO_INCOME_BRACKETS_2024,
  OHIO_STANDARD_DEDUCTION_2024,
  0.0399,
  0.0575,
  true,
  OHIO_FILING_SCHEMAS,
  OHIO_REGRESSION_TESTS,
  [
    { type: 'revenue', amount: 100000, currency: 'USD', period: 'annual', description: 'OH remote seller threshold' },
    { type: 'transactions', transactions: 200, description: 'OH transaction threshold' },
  ]
);

// Georgia
const GEORGIA_INCOME_BRACKETS_2024: Record<FilingStatus, USIncomeTaxBracket[]> = {
  single: [
    { min: 0, max: 750, rate: 0.01 },
    { min: 750, max: 2250, rate: 0.02 },
    { min: 2250, max: 3750, rate: 0.03 },
    { min: 3750, max: 5250, rate: 0.04 },
    { min: 5250, max: 7000, rate: 0.05 },
    { min: 7000, max: null, rate: 0.0575 },
  ],
  married: [
    { min: 0, max: 1000, rate: 0.01 },
    { min: 1000, max: 3000, rate: 0.02 },
    { min: 3000, max: 5000, rate: 0.03 },
    { min: 5000, max: 7000, rate: 0.04 },
    { min: 7000, max: 10000, rate: 0.05 },
    { min: 10000, max: null, rate: 0.0575 },
  ],
  head: [
    { min: 0, max: 1000, rate: 0.01 },
    { min: 1000, max: 3000, rate: 0.02 },
    { min: 3000, max: 5000, rate: 0.03 },
    { min: 5000, max: 7000, rate: 0.04 },
    { min: 7000, max: 10000, rate: 0.05 },
    { min: 10000, max: null, rate: 0.0575 },
  ],
};

const GEORGIA_STANDARD_DEDUCTION_2024: Record<FilingStatus, number> = {
  single: 5400,
  married: 7200,
  head: 7200,
};

const GEORGIA_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'Form 500',
    jurisdictionCode: 'US-GA',
    description: 'Georgia Individual Income Tax Return',
    frequency: 'annual',
    method: 'efile',
    dueDaysAfterPeriod: 105,
    boxes: [
      { id: '1', label: 'Federal AGI', calculation: 'amount' },
      { id: '15', label: 'Georgia taxable income', calculation: 'taxableIncome' },
      { id: '16', label: 'Total tax', calculation: 'taxAmount' },
    ],
  },
  {
    form: 'ST-3',
    jurisdictionCode: 'US-GA',
    description: 'Georgia Sales and Use Tax Return',
    frequency: 'monthly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Total sales', calculation: 'amount' },
      { id: '2', label: 'Tax due', calculation: 'taxAmount' },
    ],
  },
];

const GEORGIA_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'us-ga-income-single-65k',
    description: 'Single filer $65k Georgia income',
    transaction: {
      amount: 65000,
      type: 'income',
      filingStatus: 'single',
    },
    expected: {
      taxAmount: 3737.5,
      taxRate: 0.0575,
      filingBoxes: {
        '1': 65000,
        '15': 59600,
        '16': 3737.5,
      },
    },
  },
];

const GEORGIA_RULEPACK = createStateRulepack(
  'GA',
  'Georgia',
  GEORGIA_INCOME_BRACKETS_2024,
  GEORGIA_STANDARD_DEDUCTION_2024,
  0.0575,
  0.04,
  true,
  GEORGIA_FILING_SCHEMAS,
  GEORGIA_REGRESSION_TESTS,
  [
    { type: 'revenue', amount: 100000, currency: 'USD', period: 'annual', description: 'GA remote seller threshold' },
    { type: 'transactions', transactions: 200, description: 'GA transaction threshold' },
  ]
);

// North Carolina
const NORTH_CAROLINA_INCOME_BRACKETS_2024: USIncomeTaxBracket[] = [
  { min: 0, max: null, rate: 0.0475 },
];

const NORTH_CAROLINA_STANDARD_DEDUCTION_2024: Record<FilingStatus, number> = {
  single: 12550,
  married: 25100,
  head: 18825,
};

const NORTH_CAROLINA_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'D-400',
    jurisdictionCode: 'US-NC',
    description: 'North Carolina Individual Income Tax Return',
    frequency: 'annual',
    method: 'efile',
    dueDaysAfterPeriod: 105,
    boxes: [
      { id: '1', label: 'Federal AGI', calculation: 'amount' },
      { id: '15', label: 'NC taxable income', calculation: 'taxableIncome' },
      { id: '16', label: 'Total tax', calculation: 'taxAmount' },
    ],
  },
  {
    form: 'E-500',
    jurisdictionCode: 'US-NC',
    description: 'North Carolina Sales and Use Tax Return',
    frequency: 'monthly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Total sales', calculation: 'amount' },
      { id: '2', label: 'Tax due', calculation: 'taxAmount' },
    ],
  },
];

const NORTH_CAROLINA_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'us-nc-income-single-60k',
    description: 'Single filer $60k North Carolina income',
    transaction: {
      amount: 60000,
      type: 'income',
      filingStatus: 'single',
    },
    expected: {
      taxAmount: 2281.25,
      taxRate: 0.0475,
      filingBoxes: {
        '1': 60000,
        '15': 47450,
        '16': 2281.25,
      },
    },
  },
];

const NORTH_CAROLINA_RULEPACK = createStateRulepack(
  'NC',
  'North Carolina',
  NORTH_CAROLINA_INCOME_BRACKETS_2024,
  NORTH_CAROLINA_STANDARD_DEDUCTION_2024,
  0.0475,
  0.0475,
  true,
  NORTH_CAROLINA_FILING_SCHEMAS,
  NORTH_CAROLINA_REGRESSION_TESTS,
  [
    { type: 'revenue', amount: 100000, currency: 'USD', period: 'annual', description: 'NC remote seller threshold' },
    { type: 'transactions', transactions: 200, description: 'NC transaction threshold' },
  ]
);

// Michigan
const MICHIGAN_INCOME_BRACKETS_2024: USIncomeTaxBracket[] = [
  { min: 0, max: null, rate: 0.0425 },
];

const MICHIGAN_STANDARD_DEDUCTION_2024: Record<FilingStatus, number> = {
  single: 5000,
  married: 10000,
  head: 5000,
};

const MICHIGAN_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'MI-1040',
    jurisdictionCode: 'US-MI',
    description: 'Michigan Individual Income Tax Return',
    frequency: 'annual',
    method: 'efile',
    dueDaysAfterPeriod: 105,
    boxes: [
      { id: '1', label: 'Federal AGI', calculation: 'amount' },
      { id: '15', label: 'Michigan taxable income', calculation: 'taxableIncome' },
      { id: '16', label: 'Total tax', calculation: 'taxAmount' },
    ],
  },
  {
    form: 'Form 160',
    jurisdictionCode: 'US-MI',
    description: 'Michigan Sales and Use Tax Return',
    frequency: 'monthly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Total sales', calculation: 'amount' },
      { id: '2', label: 'Tax due', calculation: 'taxAmount' },
    ],
  },
];

const MICHIGAN_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'us-mi-income-single-55k',
    description: 'Single filer $55k Michigan income',
    transaction: {
      amount: 55000,
      type: 'income',
      filingStatus: 'single',
    },
    expected: {
      taxAmount: 2337.5,
      taxRate: 0.0425,
      filingBoxes: {
        '1': 55000,
        '15': 50000,
        '16': 2337.5,
      },
    },
  },
];

const MICHIGAN_RULEPACK = createStateRulepack(
  'MI',
  'Michigan',
  MICHIGAN_INCOME_BRACKETS_2024,
  MICHIGAN_STANDARD_DEDUCTION_2024,
  0.0425,
  0.06,
  true,
  MICHIGAN_FILING_SCHEMAS,
  MICHIGAN_REGRESSION_TESTS,
  [
    { type: 'revenue', amount: 100000, currency: 'USD', period: 'annual', description: 'MI remote seller threshold' },
    { type: 'transactions', transactions: 200, description: 'MI transaction threshold' },
  ]
);

// Create rulepacks for remaining states with simplified structures
// This is a comprehensive list - we'll create basic rulepacks for all states

const createSimplifiedStateRulepack = (
  stateCode: string,
  stateName: string,
  incomeTaxRate: number,
  salesTaxRate: number,
  hasIncomeTax: boolean
): InstallableTaxRulepack => {
  const rules: TaxRule[] = [];
  if (hasIncomeTax && incomeTaxRate > 0) {
    rules.push({
      id: `us-${stateCode.toLowerCase()}-income-2024`,
      name: `${stateName} Income Tax 2024`,
      description: `${stateName} income tax`,
      condition: "transactionType === 'income'",
      action: 'applyFlatRate',
      priority: 1,
      isDeterministic: true,
    });
  }
  
  if (salesTaxRate > 0) {
    rules.push({
      id: `us-${stateCode.toLowerCase()}-sales-2024`,
      name: `${stateName} Sales Tax 2024`,
      description: `${stateName} sales and use tax`,
      condition: "transactionType === 'sale'",
      action: 'applySalesTax',
      priority: 2,
      isDeterministic: true,
    });
  }

  const filingSchemas: TaxFilingSchema[] = [];
  if (hasIncomeTax) {
    filingSchemas.push({
      form: `State-${stateCode}-1040`,
      jurisdictionCode: `US-${stateCode}`,
      description: `${stateName} Individual Income Tax Return`,
      frequency: 'annual',
      method: 'efile',
      dueDaysAfterPeriod: 105,
      boxes: [
        { id: '1', label: 'Total income', calculation: 'amount' },
        { id: '15', label: 'Taxable income', calculation: 'taxableIncome' },
        { id: '16', label: 'Total tax', calculation: 'taxAmount' },
      ],
    });
  }
  
  if (salesTaxRate > 0) {
    filingSchemas.push({
      form: `State-${stateCode}-ST`,
      jurisdictionCode: `US-${stateCode}`,
      description: `${stateName} Sales and Use Tax Return`,
      frequency: 'monthly',
      method: 'efile',
      boxes: [
        { id: '1', label: 'Total sales', calculation: 'amount' },
        { id: '2', label: 'Tax due', calculation: 'taxAmount' },
      ],
    });
  }

  return {
    id: `us-${stateCode.toLowerCase()}-2024-v1`,
    country: 'US',
    jurisdictionCode: `US-${stateCode}`,
    region: 'NA',
    year: 2024,
    version: '2024.1',
    rules,
    filingTypes: hasIncomeTax ? ['income_tax', 'sales_tax'] : ['sales_tax'],
    status: 'active',
    metadata: {
      ...(hasIncomeTax ? { incomeTax: { flatRate: incomeTaxRate } } : {}),
      ...(salesTaxRate > 0 ? { salesTax: { baseRate: salesTaxRate, hasLocalTax: true } } : {}),
    },
    nexusThresholds: [
      { type: 'revenue', amount: 100000, currency: 'USD', period: 'annual', description: `${stateName} remote seller threshold` },
    ],
    filingSchemas,
    regressionTests: [],
    effectiveFrom: new Date('2024-01-01'),
    isActive: true,
  };
};

// All remaining US states
const REMAINING_STATES = [
  { code: 'AL', name: 'Alabama', incomeTax: 0.05, salesTax: 0.04, hasIncomeTax: true },
  { code: 'AK', name: 'Alaska', incomeTax: 0, salesTax: 0, hasIncomeTax: false },
  { code: 'AZ', name: 'Arizona', incomeTax: 0.025, salesTax: 0.056, hasIncomeTax: true },
  { code: 'AR', name: 'Arkansas', incomeTax: 0.055, salesTax: 0.065, hasIncomeTax: true },
  { code: 'CO', name: 'Colorado', incomeTax: 0.044, salesTax: 0.029, hasIncomeTax: true },
  { code: 'CT', name: 'Connecticut', incomeTax: 0.03, salesTax: 0.0635, hasIncomeTax: true },
  { code: 'DE', name: 'Delaware', incomeTax: 0.066, salesTax: 0, hasIncomeTax: true },
  { code: 'DC', name: 'District of Columbia', incomeTax: 0.075, salesTax: 0.06, hasIncomeTax: true },
  { code: 'HI', name: 'Hawaii', incomeTax: 0.11, salesTax: 0.04, hasIncomeTax: true },
  { code: 'ID', name: 'Idaho', incomeTax: 0.06, salesTax: 0.06, hasIncomeTax: true },
  { code: 'IN', name: 'Indiana', incomeTax: 0.0323, salesTax: 0.07, hasIncomeTax: true },
  { code: 'IA', name: 'Iowa', incomeTax: 0.053, salesTax: 0.06, hasIncomeTax: true },
  { code: 'KS', name: 'Kansas', incomeTax: 0.057, salesTax: 0.065, hasIncomeTax: true },
  { code: 'KY', name: 'Kentucky', incomeTax: 0.05, salesTax: 0.06, hasIncomeTax: true },
  { code: 'LA', name: 'Louisiana', incomeTax: 0.06, salesTax: 0.0445, hasIncomeTax: true },
  { code: 'ME', name: 'Maine', incomeTax: 0.075, salesTax: 0.055, hasIncomeTax: true },
  { code: 'MD', name: 'Maryland', incomeTax: 0.0575, salesTax: 0.06, hasIncomeTax: true },
  { code: 'MA', name: 'Massachusetts', incomeTax: 0.05, salesTax: 0.0625, hasIncomeTax: true },
  { code: 'MN', name: 'Minnesota', incomeTax: 0.0985, salesTax: 0.06875, hasIncomeTax: true },
  { code: 'MS', name: 'Mississippi', incomeTax: 0.05, salesTax: 0.07, hasIncomeTax: true },
  { code: 'MO', name: 'Missouri', incomeTax: 0.054, salesTax: 0.04225, hasIncomeTax: true },
  { code: 'MT', name: 'Montana', incomeTax: 0.0675, salesTax: 0, hasIncomeTax: true },
  { code: 'NE', name: 'Nebraska', incomeTax: 0.0684, salesTax: 0.055, hasIncomeTax: true },
  { code: 'NV', name: 'Nevada', incomeTax: 0, salesTax: 0.0685, hasIncomeTax: false },
  { code: 'NH', name: 'New Hampshire', incomeTax: 0.05, salesTax: 0, hasIncomeTax: true },
  { code: 'NJ', name: 'New Jersey', incomeTax: 0.1075, salesTax: 0.06625, hasIncomeTax: true },
  { code: 'NM', name: 'New Mexico', incomeTax: 0.059, salesTax: 0.05125, hasIncomeTax: true },
  { code: 'ND', name: 'North Dakota', incomeTax: 0.029, salesTax: 0.05, hasIncomeTax: true },
  { code: 'OK', name: 'Oklahoma', incomeTax: 0.05, salesTax: 0.045, hasIncomeTax: true },
  { code: 'OR', name: 'Oregon', incomeTax: 0.099, salesTax: 0, hasIncomeTax: true },
  { code: 'RI', name: 'Rhode Island', incomeTax: 0.0599, salesTax: 0.07, hasIncomeTax: true },
  { code: 'SC', name: 'South Carolina', incomeTax: 0.07, salesTax: 0.06, hasIncomeTax: true },
  { code: 'SD', name: 'South Dakota', incomeTax: 0, salesTax: 0.045, hasIncomeTax: false },
  { code: 'TN', name: 'Tennessee', incomeTax: 0, salesTax: 0.07, hasIncomeTax: false },
  { code: 'UT', name: 'Utah', incomeTax: 0.0495, salesTax: 0.061, hasIncomeTax: true },
  { code: 'VT', name: 'Vermont', incomeTax: 0.0875, salesTax: 0.06, hasIncomeTax: true },
  { code: 'VA', name: 'Virginia', incomeTax: 0.0575, salesTax: 0.053, hasIncomeTax: true },
  { code: 'WA', name: 'Washington', incomeTax: 0, salesTax: 0.065, hasIncomeTax: false },
  { code: 'WV', name: 'West Virginia', incomeTax: 0.065, salesTax: 0.06, hasIncomeTax: true },
  { code: 'WI', name: 'Wisconsin', incomeTax: 0.0765, salesTax: 0.05, hasIncomeTax: true },
  { code: 'WY', name: 'Wyoming', incomeTax: 0, salesTax: 0.04, hasIncomeTax: false },
];

const REMAINING_STATE_RULEPACKS = REMAINING_STATES.map(state =>
  createSimplifiedStateRulepack(state.code, state.name, state.incomeTax, state.salesTax, state.hasIncomeTax)
);

export function getAllUSStateRulepacks(): InstallableTaxRulepack[] {
  return [
    NEW_YORK_RULEPACK,
    TEXAS_RULEPACK,
    FLORIDA_RULEPACK,
    ILLINOIS_RULEPACK,
    PENNSYLVANIA_RULEPACK,
    OHIO_RULEPACK,
    GEORGIA_RULEPACK,
    NORTH_CAROLINA_RULEPACK,
    MICHIGAN_RULEPACK,
    ...REMAINING_STATE_RULEPACKS,
  ];
}
