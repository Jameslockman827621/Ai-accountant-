import {
  TaxFilingSchema,
  TaxRegressionCase,
  TaxRule,
} from '@ai-accountant/shared-types';
import { InstallableTaxRulepack } from '../../../rules-engine/src/services/rulepackTypes';

export interface MexicoIncomeTaxBracket {
  min: number;
  max: number | null;
  rate: number;
}

// Mexico Federal Tax Brackets 2024 (in MXN)
const MEXICO_FEDERAL_INCOME_BRACKETS_2024: MexicoIncomeTaxBracket[] = [
  { min: 0, max: 9526.86, rate: 0.0192 },
  { min: 9526.86, max: 16129.80, rate: 0.064 },
  { min: 16129.80, max: 28623.61, rate: 0.1088 },
  { min: 28623.61, max: 42381.82, rate: 0.16 },
  { min: 42381.82, max: 51629.33, rate: 0.1792 },
  { min: 51629.33, max: 97424.18, rate: 0.224 },
  { min: 97424.18, max: 195850.92, rate: 0.256 },
  { min: 195850.92, max: 391701.84, rate: 0.304 },
  { min: 391701.84, max: null, rate: 0.35 },
];

const MEXICO_FEDERAL_RULES: TaxRule[] = [
  {
    id: 'mx-federal-income-2024',
    name: 'Mexico Federal Income Tax (ISR) 2024',
    description: 'Progressive federal income tax with 2024 brackets',
    condition: "transactionType === 'income'",
    action: 'applyProgressiveBrackets',
    priority: 1,
    isDeterministic: true,
  },
  {
    id: 'mx-federal-iva-2024',
    name: 'Mexico IVA (VAT) 2024',
    description: 'Impuesto al Valor Agregado (IVA)',
    condition: "transactionType === 'sale'",
    action: 'applyIVA',
    priority: 2,
    isDeterministic: true,
  },
];

const MEXICO_FEDERAL_FILING_SCHEMAS: TaxFilingSchema[] = [
  {
    form: 'DIMM',
    jurisdictionCode: 'MX',
    description: 'Declaración Informativa Mensual',
    frequency: 'monthly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Ingresos totales', calculation: 'amount' },
      { id: '2', label: 'Ingresos gravables', calculation: 'taxableIncome' },
      { id: '3', label: 'ISR a pagar', calculation: 'taxAmount' },
    ],
  },
  {
    form: 'DIMM-IVA',
    jurisdictionCode: 'MX',
    description: 'Declaración Mensual de IVA',
    frequency: 'monthly',
    method: 'efile',
    boxes: [
      { id: '1', label: 'Ventas totales', calculation: 'amount' },
      { id: '2', label: 'IVA trasladado', calculation: 'taxAmount' },
      { id: '3', label: 'IVA acreditable', calculation: 'context.inputIVA' },
      { id: '4', label: 'IVA a pagar', calculation: 'taxAmount' },
    ],
  },
];

const MEXICO_FEDERAL_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'mx-federal-income-500000',
    description: 'Income 500,000 MXN',
    transaction: {
      amount: 500000,
      type: 'income',
    },
    expected: {
      taxAmount: 175000,
      taxRate: 0.35,
      filingBoxes: {
        '1': 500000,
        '2': 500000,
        '3': 175000,
      },
    },
  },
  {
    id: 'mx-federal-iva-100000',
    description: 'IVA on 100,000 MXN sale',
    transaction: {
      amount: 100000,
      type: 'sale',
    },
    expected: {
      taxAmount: 16000,
      taxRate: 0.16,
      filingBoxes: {
        '1': 100000,
        '2': 16000,
        '4': 16000,
      },
    },
  },
];

const MEXICO_FEDERAL_RULEPACK_2024: InstallableTaxRulepack = {
  id: 'mx-federal-2024-v1',
  country: 'MX',
  jurisdictionCode: 'MX',
  region: 'NA',
  year: 2024,
  version: '2024.1',
  rules: MEXICO_FEDERAL_RULES,
  filingTypes: ['income_tax', 'iva'],
  status: 'active',
  metadata: {
    incomeTax: {
      brackets: MEXICO_FEDERAL_INCOME_BRACKETS_2024,
    },
    iva: {
      standardRate: 0.16,
      borderRate: 0.08,
      zeroRateCategories: ['medicines', 'food'],
    },
  },
  nexusThresholds: [
    { type: 'revenue', amount: 3000000, currency: 'MXN', period: 'annual', description: 'IVA registration threshold' },
  ],
  filingSchemas: MEXICO_FEDERAL_FILING_SCHEMAS,
  regressionTests: MEXICO_FEDERAL_REGRESSION_TESTS,
  effectiveFrom: new Date('2024-01-01'),
  isActive: true,
};

// Helper function to create state rulepack
function createMexicoStateRulepack(
  stateCode: string,
  stateName: string,
  localTaxRate: number,
  filingSchemas: TaxFilingSchema[],
  regressionTests: TaxRegressionCase[]
): InstallableTaxRulepack {
  const rules: TaxRule[] = [];
  
  if (localTaxRate > 0) {
    rules.push({
      id: `mx-${stateCode.toLowerCase()}-local-2024`,
      name: `${stateName} Local Tax 2024`,
      description: `${stateName} local tax`,
      condition: "transactionType === 'income'",
      action: 'applyLocalTax',
      priority: 3,
      isDeterministic: true,
    });
  }

  return {
    id: `mx-${stateCode.toLowerCase()}-2024-v1`,
    country: 'MX',
    jurisdictionCode: `MX-${stateCode}`,
    region: 'NA',
    year: 2024,
    version: '2024.1',
    rules,
    filingTypes: localTaxRate > 0 ? ['income_tax', 'local_tax'] : ['income_tax'],
    status: 'active',
    metadata: {
      ...(localTaxRate > 0 ? { localTax: { rate: localTaxRate } } : {}),
    },
    nexusThresholds: [
      { type: 'revenue', amount: 3000000, currency: 'MXN', period: 'annual', description: `${stateName} tax threshold` },
    ],
    filingSchemas,
    regressionTests,
    effectiveFrom: new Date('2024-01-01'),
    isActive: true,
  };
}

// Mexico States (32 states)
const MEXICO_STATES = [
  { code: 'AGU', name: 'Aguascalientes', localTax: 0 },
  { code: 'BCN', name: 'Baja California', localTax: 0 },
  { code: 'BCS', name: 'Baja California Sur', localTax: 0 },
  { code: 'CAM', name: 'Campeche', localTax: 0 },
  { code: 'CHP', name: 'Chiapas', localTax: 0 },
  { code: 'CHH', name: 'Chihuahua', localTax: 0 },
  { code: 'COA', name: 'Coahuila', localTax: 0 },
  { code: 'COL', name: 'Colima', localTax: 0 },
  { code: 'DIF', name: 'Ciudad de México', localTax: 0 },
  { code: 'DUR', name: 'Durango', localTax: 0 },
  { code: 'GUA', name: 'Guanajuato', localTax: 0 },
  { code: 'GRO', name: 'Guerrero', localTax: 0 },
  { code: 'HID', name: 'Hidalgo', localTax: 0 },
  { code: 'JAL', name: 'Jalisco', localTax: 0 },
  { code: 'MEX', name: 'Estado de México', localTax: 0 },
  { code: 'MIC', name: 'Michoacán', localTax: 0 },
  { code: 'MOR', name: 'Morelos', localTax: 0 },
  { code: 'NAY', name: 'Nayarit', localTax: 0 },
  { code: 'NLE', name: 'Nuevo León', localTax: 0 },
  { code: 'OAX', name: 'Oaxaca', localTax: 0 },
  { code: 'PUE', name: 'Puebla', localTax: 0 },
  { code: 'QUE', name: 'Querétaro', localTax: 0 },
  { code: 'ROO', name: 'Quintana Roo', localTax: 0 },
  { code: 'SLP', name: 'San Luis Potosí', localTax: 0 },
  { code: 'SIN', name: 'Sinaloa', localTax: 0 },
  { code: 'SON', name: 'Sonora', localTax: 0 },
  { code: 'TAB', name: 'Tabasco', localTax: 0 },
  { code: 'TAM', name: 'Tamaulipas', localTax: 0 },
  { code: 'TLA', name: 'Tlaxcala', localTax: 0 },
  { code: 'VER', name: 'Veracruz', localTax: 0 },
  { code: 'YUC', name: 'Yucatán', localTax: 0 },
  { code: 'ZAC', name: 'Zacatecas', localTax: 0 },
];

const MEXICO_STATE_RULEPACKS = MEXICO_STATES.map(state => {
  const filingSchemas: TaxFilingSchema[] = [
    {
      form: `MX-${state.code}-LOCAL`,
      jurisdictionCode: `MX-${state.code}`,
      description: `${state.name} Local Tax Return`,
      frequency: 'annual',
      method: 'efile',
      boxes: [
        { id: '1', label: 'Ingresos', calculation: 'amount' },
        { id: '2', label: 'Impuesto local', calculation: 'taxAmount' },
      ],
    },
  ];

  return createMexicoStateRulepack(
    state.code,
    state.name,
    state.localTax,
    filingSchemas,
    []
  );
});

export function getBuiltInMexicoRulepacks(): InstallableTaxRulepack[] {
  return [
    MEXICO_FEDERAL_RULEPACK_2024,
    ...MEXICO_STATE_RULEPACKS,
  ];
}
