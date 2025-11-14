import { createLogger } from '@ai-accountant/shared-utils';
import { EntityTaxProfile } from './ukTaxEntities';

const logger = createLogger('rules-engine-service');

export interface ComprehensiveTaxYear {
  taxYear: string;
  startDate: Date;
  endDate: Date;
  rates: EntityTaxProfile;
}

// Comprehensive UK Tax Rates for all years 2020-2025
export const COMPREHENSIVE_TAX_YEARS: Record<string, ComprehensiveTaxYear> = {
  '2024-25': {
    taxYear: '2024-25',
    startDate: new Date('2024-04-06'),
    endDate: new Date('2025-04-05'),
    rates: {
      entityType: 'sole_trader',
      taxYear: '2024-25',
      incomeTax: {
        applicable: true,
        personalAllowance: 12570,
        basicRate: { threshold: 50270, rate: 0.20 },
        higherRate: { threshold: 125140, rate: 0.40 },
        additionalRate: { threshold: Infinity, rate: 0.45 },
        dividendAllowance: 500,
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
        mainRate: 0.25,
        smallProfitsRate: 0.19,
        smallProfitsThreshold: 50000,
        marginalReliefFraction: 0.015,
        marginalReliefUpperLimit: 250000,
      },
      vat: {
        registrationThreshold: 90000,
        deregistrationThreshold: 88000,
        standardRate: 0.20,
        reducedRate: 0.05,
        zeroRate: true,
        exempt: false,
        flatRateScheme: true,
        flatRatePercentages: {},
      },
      capitalGainsTax: {
        applicable: true,
        annualExemptAmount: 3000,
        basicRate: 0.10,
        higherRate: 0.20,
        entrepreneursReliefRate: 0.10,
        entrepreneursReliefLifetimeLimit: 1000000,
      },
      filingDeadlines: {
        selfAssessment: '31 Jan',
        corporationTax: '9 months + 1 day',
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
  },
  '2023-24': {
    taxYear: '2023-24',
    startDate: new Date('2023-04-06'),
    endDate: new Date('2024-04-05'),
    rates: {
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
        mainRate: 0.25,
        smallProfitsRate: 0.19,
        smallProfitsThreshold: 50000,
        marginalReliefFraction: 0.015,
        marginalReliefUpperLimit: 250000,
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
        corporationTax: '9 months + 1 day',
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
  },
  '2022-23': {
    taxYear: '2022-23',
    startDate: new Date('2022-04-06'),
    endDate: new Date('2023-04-05'),
    rates: {
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
        corporationTax: '9 months + 1 day',
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
  },
  '2021-22': {
    taxYear: '2021-22',
    startDate: new Date('2021-04-06'),
    endDate: new Date('2022-04-05'),
    rates: {
      entityType: 'sole_trader',
      taxYear: '2021-22',
      incomeTax: {
        applicable: true,
        personalAllowance: 12570,
        basicRate: { threshold: 50270, rate: 0.20 },
        higherRate: { threshold: 150000, rate: 0.40 },
        additionalRate: { threshold: Infinity, rate: 0.45 },
        dividendAllowance: 2000,
        dividendBasicRate: 0.075,
        dividendHigherRate: 0.325,
        dividendAdditionalRate: 0.381,
        savingsAllowance: 1000,
        savingsBasicRate: 0.20,
        savingsHigherRate: 0.40,
      },
      nationalInsurance: {
        applicable: true,
        class2: { weeklyRate: 3.05, smallProfitsThreshold: 6515 },
        class4: { lowerProfitsLimit: 9568, upperProfitsLimit: 50270, lowerRate: 0.09, upperRate: 0.02 },
        class1: { employeeRate: 0.12, employerRate: 0.138, thresholds: { primary: 9568, upper: 50270 } },
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
        corporationTax: '9 months + 1 day',
        vat: '1 month + 7 days',
        paye: '19th of following month',
      },
      allowances: {
        tradingAllowance: 1000,
        propertyAllowance: 1000,
        marriageAllowance: 1260,
        blindPersonsAllowance: 2590,
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
  },
  '2020-21': {
    taxYear: '2020-21',
    startDate: new Date('2020-04-06'),
    endDate: new Date('2021-04-05'),
    rates: {
      entityType: 'sole_trader',
      taxYear: '2020-21',
      incomeTax: {
        applicable: true,
        personalAllowance: 12500,
        basicRate: { threshold: 50000, rate: 0.20 },
        higherRate: { threshold: 150000, rate: 0.40 },
        additionalRate: { threshold: Infinity, rate: 0.45 },
        dividendAllowance: 2000,
        dividendBasicRate: 0.075,
        dividendHigherRate: 0.325,
        dividendAdditionalRate: 0.381,
        savingsAllowance: 1000,
        savingsBasicRate: 0.20,
        savingsHigherRate: 0.40,
      },
      nationalInsurance: {
        applicable: true,
        class2: { weeklyRate: 3.05, smallProfitsThreshold: 6515 },
        class4: { lowerProfitsLimit: 9500, upperProfitsLimit: 50000, lowerRate: 0.09, upperRate: 0.02 },
        class1: { employeeRate: 0.12, employerRate: 0.138, thresholds: { primary: 9500, upper: 50000 } },
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
        corporationTax: '9 months + 1 day',
        vat: '1 month + 7 days',
        paye: '19th of following month',
      },
      allowances: {
        tradingAllowance: 1000,
        propertyAllowance: 1000,
        marriageAllowance: 1250,
        blindPersonsAllowance: 2510,
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
  },
};

export function getTaxYearForDate(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // UK tax year runs from 6 April to 5 April
  if (month > 4 || (month === 4 && day >= 6)) {
    return `${year}-${String(year + 1).slice(-2)}`;
  } else {
    return `${year - 1}-${String(year).slice(-2)}`;
  }
}

export function getTaxRatesForDate(date: Date): EntityTaxProfile | null {
  const taxYear = getTaxYearForDate(date);
  const yearData = COMPREHENSIVE_TAX_YEARS[taxYear];
  return yearData ? yearData.rates : null;
}

export function getAllTaxYears(): string[] {
  return Object.keys(COMPREHENSIVE_TAX_YEARS).sort().reverse();
}

export function getTaxYearData(taxYear: string): ComprehensiveTaxYear | null {
  return COMPREHENSIVE_TAX_YEARS[taxYear] || null;
}
