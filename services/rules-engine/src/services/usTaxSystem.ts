import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('rules-engine-service');

/**
 * US Tax System Support
 * Implements US federal and state tax calculations
 */

export interface USTaxRates {
  federal: {
    incomeTax: Array<{ bracket: number; rate: number }>;
    socialSecurity: number; // 6.2% for employee
    medicare: number; // 1.45% for employee
    medicareAdditional: number; // 0.9% for high earners
  };
  state?: {
    name: string;
    incomeTax: Array<{ bracket: number; rate: number }>;
    salesTax: number;
  };
}

/**
 * Calculate US federal income tax
 */
export function calculateUSFederalIncomeTax(income: number, filingStatus: 'single' | 'married_joint' | 'married_separate' | 'head_of_household'): number {
  // 2024 tax brackets (simplified)
  const brackets = {
    single: [
      { min: 0, max: 11000, rate: 0.10 },
      { min: 11000, max: 44725, rate: 0.12 },
      { min: 44725, max: 95375, rate: 0.22 },
      { min: 95375, max: 201050, rate: 0.24 },
      { min: 201050, max: 510300, rate: 0.32 },
      { min: 510300, max: Infinity, rate: 0.37 },
    ],
    married_joint: [
      { min: 0, max: 22000, rate: 0.10 },
      { min: 22000, max: 89450, rate: 0.12 },
      { min: 89450, max: 190750, rate: 0.22 },
      { min: 190750, max: 364200, rate: 0.24 },
      { min: 364200, max: 462500, rate: 0.32 },
      { min: 462500, max: Infinity, rate: 0.37 },
    ],
    married_separate: [
      { min: 0, max: 11000, rate: 0.10 },
      { min: 11000, max: 44725, rate: 0.12 },
      { min: 44725, max: 95375, rate: 0.22 },
      { min: 95375, max: 201050, rate: 0.24 },
      { min: 201050, max: 255150, rate: 0.32 },
      { min: 255150, max: Infinity, rate: 0.37 },
    ],
    head_of_household: [
      { min: 0, max: 15700, rate: 0.10 },
      { min: 15700, max: 59850, rate: 0.12 },
      { min: 59850, max: 95350, rate: 0.22 },
      { min: 95350, max: 201050, rate: 0.24 },
      { min: 201050, max: 510300, rate: 0.32 },
      { min: 510300, max: Infinity, rate: 0.37 },
    ],
  };

  const taxBrackets = brackets[filingStatus];
  let tax = 0;
  let remainingIncome = income;

  for (const bracket of taxBrackets) {
    if (remainingIncome <= 0) break;

    const taxableInBracket = Math.min(remainingIncome, bracket.max - bracket.min);
    tax += taxableInBracket * bracket.rate;
    remainingIncome -= taxableInBracket;
  }

  return tax;
}

/**
 * Calculate US Social Security tax
 */
export function calculateUSSocialSecurityTax(income: number): number {
  const socialSecurityWageBase = 168600; // 2024
  const socialSecurityRate = 0.062; // 6.2%
  const taxableIncome = Math.min(income, socialSecurityWageBase);
  return taxableIncome * socialSecurityRate;
}

/**
 * Calculate US Medicare tax
 */
export function calculateUSMedicareTax(income: number): number {
  const medicareRate = 0.0145; // 1.45%
  const medicareAdditionalRate = 0.009; // 0.9% for high earners
  const medicareAdditionalThreshold = 200000; // Single, 250000 for married

  let tax = income * medicareRate;

  // Additional Medicare tax for high earners
  if (income > medicareAdditionalThreshold) {
    tax += (income - medicareAdditionalThreshold) * medicareAdditionalRate;
  }

  return tax;
}

/**
 * Calculate US state income tax (example: California)
 */
export function calculateUSStateIncomeTax(income: number, state: string): number {
  // Simplified state tax calculation
  // In production, would have full state tax tables
  const stateRates: Record<string, number> = {
    'CA': 0.133, // California top rate (simplified)
    'NY': 0.1082, // New York top rate
    'TX': 0, // Texas has no state income tax
    'FL': 0, // Florida has no state income tax
  };

  const rate = stateRates[state.toUpperCase()] || 0;
  return income * rate;
}

/**
 * Calculate US sales tax
 */
export function calculateUSSalesTax(amount: number, state: string, localRate: number = 0): number {
  const stateRates: Record<string, number> = {
    'CA': 0.0725,
    'NY': 0.04,
    'TX': 0.0625,
    'FL': 0.06,
  };

  const stateRate = stateRates[state.toUpperCase()] || 0;
  const totalRate = stateRate + localRate;
  return amount * totalRate;
}
