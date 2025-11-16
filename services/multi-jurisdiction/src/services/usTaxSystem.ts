import { createLogger } from '@ai-accountant/shared-utils';

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

// Federal Income Tax Brackets (2024)
const FEDERAL_INCOME_TAX_BRACKETS_2024: USIncomeTaxBracket[] = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: null, rate: 0.37 },
];

// State Tax Rates (simplified - actual rates vary by income brackets)
const STATE_TAX_RATES: Record<string, USStateTax> = {
  CA: { state: 'California', incomeTaxRate: 0.13, salesTaxRate: 0.0725, hasLocalTax: true },
  NY: { state: 'New York', incomeTaxRate: 0.10, salesTaxRate: 0.08, hasLocalTax: true },
  TX: { state: 'Texas', incomeTaxRate: 0, salesTaxRate: 0.0625, hasLocalTax: true },
  FL: { state: 'Florida', incomeTaxRate: 0, salesTaxRate: 0.06, hasLocalTax: true },
  IL: { state: 'Illinois', incomeTaxRate: 0.0495, salesTaxRate: 0.0625, hasLocalTax: true },
  PA: { state: 'Pennsylvania', incomeTaxRate: 0.0307, salesTaxRate: 0.06, hasLocalTax: true },
  OH: { state: 'Ohio', incomeTaxRate: 0.0399, salesTaxRate: 0.0575, hasLocalTax: true },
  GA: { state: 'Georgia', incomeTaxRate: 0.0575, salesTaxRate: 0.04, hasLocalTax: true },
  NC: { state: 'North Carolina', incomeTaxRate: 0.0525, salesTaxRate: 0.0475, hasLocalTax: true },
  MI: { state: 'Michigan', incomeTaxRate: 0.0425, salesTaxRate: 0.06, hasLocalTax: true },
};

export function calculateUSFederalIncomeTax(income: number, filingStatus: 'single' | 'married' | 'head' = 'single'): number {
  let tax = 0;
  let remainingIncome = income;

  for (const bracket of FEDERAL_INCOME_TAX_BRACKETS_2024) {
    if (remainingIncome <= 0) break;

    const bracketSize = bracket.max === null 
      ? remainingIncome 
      : Math.min(remainingIncome, bracket.max - bracket.min);
    
    if (bracketSize > 0) {
      tax += bracketSize * bracket.rate;
      remainingIncome -= bracketSize;
    }
  }

  return Math.round(tax * 100) / 100;
}

export function calculateUSStateIncomeTax(income: number, stateCode: string): number {
  const stateTax = STATE_TAX_RATES[stateCode.toUpperCase()];
  if (!stateTax || stateTax.incomeTaxRate === 0) {
    return 0;
  }

  // Simplified flat rate calculation - actual state taxes have brackets
  return Math.round(income * stateTax.incomeTaxRate * 100) / 100;
}

export function calculateUSSalesTax(amount: number, stateCode: string, localRate: number = 0): number {
  const stateTax = STATE_TAX_RATES[stateCode.toUpperCase()];
  if (!stateTax) {
    logger.warn(`Unknown state code: ${stateCode}`);
    return 0;
  }

  const totalRate = stateTax.salesTaxRate + localRate;
  return Math.round(amount * totalRate * 100) / 100;
}

export function getUSStateTaxInfo(stateCode: string): USStateTax | null {
  return STATE_TAX_RATES[stateCode.toUpperCase()] || null;
}

export function calculateUSTotalTax(
  income: number,
  stateCode: string,
  filingStatus: 'single' | 'married' | 'head' = 'single',
  localIncomeTaxRate: number = 0
): {
  federalIncomeTax: number;
  stateIncomeTax: number;
  localIncomeTax: number;
  totalIncomeTax: number;
} {
  const federalIncomeTax = calculateUSFederalIncomeTax(income, filingStatus);
  const stateIncomeTax = calculateUSStateIncomeTax(income, stateCode);
  const localIncomeTax = localIncomeTaxRate > 0 ? Math.round(income * localIncomeTaxRate * 100) / 100 : 0;

  return {
    federalIncomeTax,
    stateIncomeTax,
    localIncomeTax,
    totalIncomeTax: federalIncomeTax + stateIncomeTax + localIncomeTax,
  };
}
