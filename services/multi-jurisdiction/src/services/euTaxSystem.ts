import { createLogger } from '@ai-accountant/shared-utils';
import { TaxFilingSchema, TaxRegressionCase, TaxRule } from '@ai-accountant/shared-types';
import { InstallableTaxRulepack } from '../../../rules-engine/src/services/rulepackTypes';

const logger = createLogger('eu-tax-system');

export interface EUTaxInfo {
  country: string;
  countryCode: string;
  vatRate: number;
  reducedVatRate: number;
  incomeTaxRate: number;
  corporateTaxRate: number;
  currency: string;
}

const EU_TAX_INFO: Record<string, EUTaxInfo> = {
  DE: {
    country: 'Germany',
    countryCode: 'DE',
    vatRate: 0.19,
    reducedVatRate: 0.07,
    incomeTaxRate: 0.45,
    corporateTaxRate: 0.15,
    currency: 'EUR',
  },
  FR: {
    country: 'France',
    countryCode: 'FR',
    vatRate: 0.20,
    reducedVatRate: 0.055,
    incomeTaxRate: 0.45,
    corporateTaxRate: 0.25,
    currency: 'EUR',
  },
  ES: {
    country: 'Spain',
    countryCode: 'ES',
    vatRate: 0.21,
    reducedVatRate: 0.10,
    incomeTaxRate: 0.45,
    corporateTaxRate: 0.25,
    currency: 'EUR',
  },
  IT: {
    country: 'Italy',
    countryCode: 'IT',
    vatRate: 0.22,
    reducedVatRate: 0.10,
    incomeTaxRate: 0.43,
    corporateTaxRate: 0.24,
    currency: 'EUR',
  },
  NL: {
    country: 'Netherlands',
    countryCode: 'NL',
    vatRate: 0.21,
    reducedVatRate: 0.09,
    incomeTaxRate: 0.49,
    corporateTaxRate: 0.25,
    currency: 'EUR',
  },
  BE: {
    country: 'Belgium',
    countryCode: 'BE',
    vatRate: 0.21,
    reducedVatRate: 0.06,
    incomeTaxRate: 0.50,
    corporateTaxRate: 0.25,
    currency: 'EUR',
  },
  AT: {
    country: 'Austria',
    countryCode: 'AT',
    vatRate: 0.20,
    reducedVatRate: 0.10,
    incomeTaxRate: 0.55,
    corporateTaxRate: 0.25,
    currency: 'EUR',
  },
  IE: {
    country: 'Ireland',
    countryCode: 'IE',
    vatRate: 0.23,
    reducedVatRate: 0.135,
    incomeTaxRate: 0.40,
    corporateTaxRate: 0.125,
    currency: 'EUR',
  },
  PT: {
    country: 'Portugal',
    countryCode: 'PT',
    vatRate: 0.23,
    reducedVatRate: 0.06,
    incomeTaxRate: 0.48,
    corporateTaxRate: 0.21,
    currency: 'EUR',
  },
  SE: {
    country: 'Sweden',
    countryCode: 'SE',
    vatRate: 0.25,
    reducedVatRate: 0.12,
    incomeTaxRate: 0.57,
    corporateTaxRate: 0.20,
    currency: 'SEK',
  },
  DK: {
    country: 'Denmark',
    countryCode: 'DK',
    vatRate: 0.25,
    reducedVatRate: 0.0,
    incomeTaxRate: 0.56,
    corporateTaxRate: 0.22,
    currency: 'DKK',
  },
  FI: {
    country: 'Finland',
    countryCode: 'FI',
    vatRate: 0.24,
    reducedVatRate: 0.14,
    incomeTaxRate: 0.31,
    corporateTaxRate: 0.20,
    currency: 'EUR',
  },
};

const GERMANY_RULES: TaxRule[] = [
  {
    id: 'de-vat-standard',
    name: 'Germany VAT Standard Rate',
    description: 'Apply 19% VAT for standard supplies',
    condition: "transactionType === 'sale' && category !== 'reduced'",
    action: 'rate=0.19',
    priority: 1,
    isDeterministic: true,
  },
  {
    id: 'de-vat-reduced',
    name: 'Germany Reduced VAT',
    description: 'Apply 7% VAT for reduced-rate goods',
    condition: "transactionType === 'sale' && category === 'reduced'",
    action: 'rate=0.07',
    priority: 2,
    isDeterministic: true,
  },
];

const FRANCE_RULES: TaxRule[] = [
  {
    id: 'fr-vat-standard',
    name: 'France VAT Standard Rate',
    description: 'Apply 20% VAT for standard supplies',
    condition: "transactionType === 'sale' && category !== 'reduced'",
    action: 'rate=0.20',
    priority: 1,
    isDeterministic: true,
  },
  {
    id: 'fr-vat-reduced',
    name: 'France Reduced VAT',
    description: 'Apply 5.5% VAT for essentials',
    condition: "transactionType === 'sale' && category === 'reduced'",
    action: 'rate=0.055',
    priority: 2,
    isDeterministic: true,
  },
];

const GERMANY_FILING_SCHEMA: TaxFilingSchema = {
  form: 'USt-VA',
  jurisdictionCode: 'DE',
  description: 'Monthly German VAT return',
  frequency: 'monthly',
  method: 'efile',
  boxes: [
    { id: '81', label: 'Taxable sales (19%)', calculation: 'amount' },
    { id: '83', label: 'VAT due', calculation: 'taxAmount' },
  ],
};

const FRANCE_FILING_SCHEMA: TaxFilingSchema = {
  form: 'CA3',
  jurisdictionCode: 'FR',
  description: 'French VAT return',
  frequency: 'monthly',
  method: 'efile',
  boxes: [
    { id: 'A1', label: 'Chiffre d’affaires', calculation: 'amount' },
    { id: 'A4', label: 'TVA due', calculation: 'taxAmount' },
  ],
};

const GERMANY_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'de-vat-standard-1000',
    description: 'Standard-rated sale €1,000',
    transaction: {
      amount: 1000,
      type: 'sale',
      category: 'standard',
    },
    expected: {
      taxAmount: 190,
      taxRate: 0.19,
      filingBoxes: {
        '81': 1000,
        '83': 190,
      },
    },
  },
  {
    id: 'de-vat-reduced-500',
    description: 'Reduced-rated sale €500',
    transaction: {
      amount: 500,
      type: 'sale',
      category: 'reduced',
    },
    expected: {
      taxAmount: 35,
      taxRate: 0.07,
    },
  },
];

const FRANCE_REGRESSION_TESTS: TaxRegressionCase[] = [
  {
    id: 'fr-vat-standard-800',
    description: 'Standard VAT sale €800',
    transaction: {
      amount: 800,
      type: 'sale',
    },
    expected: {
      taxAmount: 160,
      taxRate: 0.2,
      filingBoxes: {
        A1: 800,
        A4: 160,
      },
    },
  },
];

const GERMANY_RULEPACK_2024: InstallableTaxRulepack = {
  id: 'de-vat-2024-v1',
  country: 'DE',
  jurisdictionCode: 'DE',
  region: 'EU',
  year: 2024,
  version: '2024.1',
  rules: GERMANY_RULES,
  filingTypes: ['vat'],
  status: 'active',
  metadata: {
    vat: {
      standardRate: 0.19,
      reducedRate: 0.07,
      zeroRateCategories: ['intra_eu_supply'],
    },
  },
  nexusThresholds: [
    { type: 'sales', amount: 22000, currency: 'EUR', description: 'Kleinunternehmer threshold' },
  ],
  filingSchemas: [GERMANY_FILING_SCHEMA],
  regressionTests: GERMANY_REGRESSION_TESTS,
  effectiveFrom: new Date('2024-01-01'),
  isActive: true,
};

const FRANCE_RULEPACK_2024: InstallableTaxRulepack = {
  id: 'fr-vat-2024-v1',
  country: 'FR',
  jurisdictionCode: 'FR',
  region: 'EU',
  year: 2024,
  version: '2024.1',
  rules: FRANCE_RULES,
  filingTypes: ['vat'],
  status: 'active',
  metadata: {
    vat: {
      standardRate: 0.2,
      reducedRate: 0.055,
      zeroRateCategories: ['exports'],
    },
  },
  nexusThresholds: [
    { type: 'sales', amount: 85000, currency: 'EUR', description: 'VAT registration threshold' },
  ],
  filingSchemas: [FRANCE_FILING_SCHEMA],
  regressionTests: FRANCE_REGRESSION_TESTS,
  effectiveFrom: new Date('2024-01-01'),
  isActive: true,
};

export function getBuiltInEUTaxRulepacks(): InstallableTaxRulepack[] {
  return [GERMANY_RULEPACK_2024, FRANCE_RULEPACK_2024];
}

export function getEUTaxInfo(countryCode: string): EUTaxInfo | null {
  return EU_TAX_INFO[countryCode.toUpperCase()] || null;
}

export function calculateEUVAT(amount: number, countryCode: string, isReduced = false): number {
  const taxInfo = getEUTaxInfo(countryCode);
  if (!taxInfo) {
    logger.warn(`Unknown EU country code: ${countryCode}`);
    return 0;
  }

  const rate = isReduced ? taxInfo.reducedVatRate : taxInfo.vatRate;
  return Math.round(amount * rate * 100) / 100;
}

export function calculateEUIncomeTax(income: number, countryCode: string): number {
  const taxInfo = getEUTaxInfo(countryCode);
  if (!taxInfo) {
    logger.warn(`Unknown EU country code: ${countryCode}`);
    return 0;
  }

  return Math.round(income * taxInfo.incomeTaxRate * 100) / 100;
}

export function calculateEUCorporateTax(profit: number, countryCode: string): number {
  const taxInfo = getEUTaxInfo(countryCode);
  if (!taxInfo) {
    logger.warn(`Unknown EU country code: ${countryCode}`);
    return 0;
  }

  return Math.round(profit * taxInfo.corporateTaxRate * 100) / 100;
}

export function getAllEUCountries(): EUTaxInfo[] {
  return Object.values(EU_TAX_INFO);
}
