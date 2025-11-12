import { createLogger } from '@ai-accountant/shared-utils';
import { EntityTaxProfile } from './ukTaxEntities';

const logger = createLogger('rules-engine-service');

export interface HistoricalTaxRates {
  [taxYear: string]: EntityTaxProfile;
}

// Historical UK Tax Rates Database
export const HISTORICAL_TAX_RATES: HistoricalTaxRates = {
  '2023-24': {
    entityType: 'sole_trader',
    taxYear: '2023-24',
    incomeTax: {
      applicable: true,
      personalAllowance: 12570,
      basicRate: { threshold: 50270, rate: 0.20 },
      higherRate: { threshold: 125140, rate: 0.40 },
      additionalRate: { threshold: Infinity, rate: 0.45 },
      dividendAllowance: 1000,
      dividendBasicRate: 0.0875,
      dividendHigherRate: 0.3375,
      dividendAdditionalRate: 0.3935,
      savingsAllowance: 1000,
      savingsBasicRate: 0.20,
      savingsHigherRate: 0.40,
    },
    nationalInsurance: {
      applicable: true,
      class2: { weeklyRate: 3.45, smallProfitsThreshold: 6725 },
      class4: { lowerProfitsLimit: 12570, upperProfitsLimit: 50270, lowerRate: 0.09, upperRate: 0.02 },
      class1: { employeeRate: 0.12, employerRate: 0.138, thresholds: { primary: 12570, upper: 50270 } },
    },
    corporationTax: {
      applicable: false,
      mainRate: 0,
      smallProfitsRate: 0,
      smallProfitsThreshold: 0,
      marginalReliefFraction: 0,
      marginalReliefUpperLimit: 0,
    },
    vat: {
      registrationThreshold: 85000,
      deregistrationThreshold: 83000,
      standardRate: 0.20,
      reducedRate: 0.05,
      zeroRate: true,
      exempt: false,
      flatRateScheme: true,
      flatRatePercentages: {},
    },
    capitalGainsTax: {
      applicable: true,
      annualExemptAmount: 6000,
      basicRate: 0.10,
      higherRate: 0.20,
      entrepreneursReliefRate: 0.10,
      entrepreneursReliefLifetimeLimit: 1000000,
    },
    filingDeadlines: {
      selfAssessment: '31 Jan',
      corporationTax: 'N/A',
      vat: '1 month + 7 days',
      paye: '19th of following month',
    },
    allowances: {
      tradingAllowance: 1000,
      propertyAllowance: 1000,
      marriageAllowance: 1260,
      blindPersonsAllowance: 2980,
    },
    reliefs: {
      annualInvestmentAllowance: 1000000,
      rndSmeRate: 1.86,
      rndLargeRate: 0.20,
      eisRate: 0.30,
      eisMaxInvestment: 2000000,
      seisRate: 0.50,
      seisMaxInvestment: 250000,
      vctRate: 0.30,
      pensionAnnualAllowance: 60000,
      pensionLifetimeAllowance: 1073100,
    },
  },
  '2022-23': {
    entityType: 'sole_trader',
    taxYear: '2022-23',
    incomeTax: {
      applicable: true,
      personalAllowance: 12570,
      basicRate: { threshold: 50270, rate: 0.20 },
      higherRate: { threshold: 150000, rate: 0.40 },
      additionalRate: { threshold: Infinity, rate: 0.45 },
      dividendAllowance: 2000,
      dividendBasicRate: 0.0875,
      dividendHigherRate: 0.3375,
      dividendAdditionalRate: 0.3935,
      savingsAllowance: 1000,
      savingsBasicRate: 0.20,
      savingsHigherRate: 0.40,
    },
    nationalInsurance: {
      applicable: true,
      class2: { weeklyRate: 3.15, smallProfitsThreshold: 6725 },
      class4: { lowerProfitsLimit: 12570, upperProfitsLimit: 50270, lowerRate: 0.105, upperRate: 0.02 },
      class1: { employeeRate: 0.1325, employerRate: 0.1513, thresholds: { primary: 12570, upper: 50270 } },
    },
    corporationTax: {
      applicable: false,
      mainRate: 0.19,
      smallProfitsRate: 0.19,
      smallProfitsThreshold: 0,
      marginalReliefFraction: 0,
      marginalReliefUpperLimit: 0,
    },
    vat: {
      registrationThreshold: 85000,
      deregistrationThreshold: 83000,
      standardRate: 0.20,
      reducedRate: 0.05,
      zeroRate: true,
      exempt: false,
      flatRateScheme: true,
      flatRatePercentages: {},
    },
    capitalGainsTax: {
      applicable: true,
      annualExemptAmount: 12300,
      basicRate: 0.10,
      higherRate: 0.20,
      entrepreneursReliefRate: 0.10,
      entrepreneursReliefLifetimeLimit: 1000000,
    },
    filingDeadlines: {
      selfAssessment: '31 Jan',
      corporationTax: 'N/A',
      vat: '1 month + 7 days',
      paye: '19th of following month',
    },
    allowances: {
      tradingAllowance: 1000,
      propertyAllowance: 1000,
      marriageAllowance: 1260,
      blindPersonsAllowance: 2980,
    },
    reliefs: {
      annualInvestmentAllowance: 1000000,
      rndSmeRate: 1.30,
      rndLargeRate: 0.13,
      eisRate: 0.30,
      eisMaxInvestment: 2000000,
      seisRate: 0.50,
      seisMaxInvestment: 250000,
      vctRate: 0.30,
      pensionAnnualAllowance: 40000,
      pensionLifetimeAllowance: 1073100,
    },
  },
  // Add more years as needed
};

export function getHistoricalTaxRates(taxYear: string): EntityTaxProfile | null {
  return HISTORICAL_TAX_RATES[taxYear] || null;
}

export function getAllAvailableTaxYears(): string[] {
  return Object.keys(HISTORICAL_TAX_RATES).sort().reverse();
}

export function getTaxRateForYear(taxYear: string, entityType: string): EntityTaxProfile | null {
  const rates = getHistoricalTaxRates(taxYear);
  if (!rates) {
    return null;
  }

  // Return entity-specific rates if available, otherwise return base rates
  return rates;
}
