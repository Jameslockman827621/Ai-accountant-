import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getEntityTaxProfile, UKEntityType } from './ukTaxEntities';

const logger = createLogger('rules-engine-service');

export interface IncomeTaxCalculation {
  taxableIncome: number;
  personalAllowance: number;
  basicRate: { income: number; tax: number };
  higherRate: { income: number; tax: number };
  additionalRate: { income: number; tax: number };
  totalTax: number;
  effectiveRate: number;
  dividends: {
    allowance: number;
    taxable: number;
    basicRateTax: number;
    higherRateTax: number;
    additionalRateTax: number;
    totalTax: number;
  };
  savings: {
    allowance: number;
    taxable: number;
    basicRateTax: number;
    higherRateTax: number;
    totalTax: number;
  };
}

export interface CorporationTaxCalculation {
  profitBeforeTax: number;
  adjustments: number;
  taxableProfit: number;
  smallProfitsRate: number;
  mainRate: number;
  marginalRelief: number;
  corporationTax: number;
  effectiveRate: number;
  afterTaxProfit: number;
}

export interface VATCalculation {
  periodStart: Date;
  periodEnd: Date;
  standardRate: {
    sales: number;
    vat: number;
  };
  reducedRate: {
    sales: number;
    vat: number;
  };
  zeroRate: {
    sales: number;
    vat: number;
  };
  exempt: {
    sales: number;
    vat: number;
  };
  inputVAT: number;
  outputVAT: number;
  netVATDue: number;
  flatRateScheme: {
    applicable: boolean;
    rate: number;
    turnover: number;
    vatDue: number;
  };
}

export interface NationalInsuranceCalculation {
  class2: {
    applicable: boolean;
    weeks: number;
    amount: number;
  };
  class4: {
    applicable: boolean;
    lowerBand: number;
    upperBand: number;
    lowerBandTax: number;
    upperBandTax: number;
    total: number;
  };
  class1: {
    employee: number;
    employer: number;
    total: number;
  };
  total: number;
}

export interface CapitalGainsTaxCalculation {
  gains: number;
  losses: number;
  netGains: number;
  annualExemptAmount: number;
  taxableGains: number;
  basicRateTax: number;
  higherRateTax: number;
  entrepreneursRelief: {
    applicable: boolean;
    amount: number;
    tax: number;
  };
  totalTax: number;
  effectiveRate: number;
}

export async function calculateIncomeTax(
  tenantId: TenantId,
  totalIncome: number,
  dividendIncome: number = 0,
  savingsIncome: number = 0,
  otherIncome: number = 0
): Promise<IncomeTaxCalculation> {
  const profile = await getEntityTaxProfile(tenantId);

  if (!profile.incomeTax.applicable) {
    return {
      taxableIncome: 0,
      personalAllowance: 0,
      basicRate: { income: 0, tax: 0 },
      higherRate: { income: 0, tax: 0 },
      additionalRate: { income: 0, tax: 0 },
      totalTax: 0,
      effectiveRate: 0,
      dividends: {
        allowance: 0,
        taxable: 0,
        basicRateTax: 0,
        higherRateTax: 0,
        additionalRateTax: 0,
        totalTax: 0,
      },
      savings: {
        allowance: 0,
        taxable: 0,
        basicRateTax: 0,
        higherRateTax: 0,
        totalTax: 0,
      },
    };
  }

  const { incomeTax } = profile;
  const personalAllowance = incomeTax.personalAllowance;

  // Calculate taxable income (excluding dividends and savings)
  const nonDividendSavingsIncome = totalIncome - dividendIncome - savingsIncome;
  let taxableIncome = Math.max(0, nonDividendSavingsIncome - personalAllowance);

  // Income tax bands
  const basicRateIncome = Math.min(taxableIncome, incomeTax.basicRate.threshold - personalAllowance);
  const higherRateIncome = Math.max(0, Math.min(
    taxableIncome - (incomeTax.basicRate.threshold - personalAllowance),
    incomeTax.higherRate.threshold - incomeTax.basicRate.threshold
  ));
  const additionalRateIncome = Math.max(0, taxableIncome - (incomeTax.higherRate.threshold - personalAllowance));

  const basicRateTax = basicRateIncome * incomeTax.basicRate.rate;
  const higherRateTax = higherRateIncome * incomeTax.higherRate.rate;
  const additionalRateTax = additionalRateIncome * incomeTax.additionalRate.rate;

  // Dividend tax
  const dividendAllowance = incomeTax.dividendAllowance;
  const taxableDividends = Math.max(0, dividendIncome - dividendAllowance);
  
  // Determine which tax band dividends fall into
  const totalIncomeForBands = nonDividendSavingsIncome + dividendIncome;
  let dividendBasicRateTax = 0;
  let dividendHigherRateTax = 0;
  let dividendAdditionalRateTax = 0;

  if (totalIncomeForBands <= incomeTax.basicRate.threshold) {
    dividendBasicRateTax = taxableDividends * incomeTax.dividendBasicRate;
  } else if (totalIncomeForBands <= incomeTax.higherRate.threshold) {
    const basicBandDividends = Math.min(taxableDividends, incomeTax.basicRate.threshold - (totalIncomeForBands - dividendIncome));
    const higherBandDividends = Math.max(0, taxableDividends - basicBandDividends);
    dividendBasicRateTax = basicBandDividends * incomeTax.dividendBasicRate;
    dividendHigherRateTax = higherBandDividends * incomeTax.dividendHigherRate;
  } else {
    const basicBandDividends = Math.min(taxableDividends, incomeTax.basicRate.threshold - (totalIncomeForBands - dividendIncome));
    const higherBandDividends = Math.min(
      taxableDividends - basicBandDividends,
      incomeTax.higherRate.threshold - incomeTax.basicRate.threshold
    );
    const additionalBandDividends = Math.max(0, taxableDividends - basicBandDividends - higherBandDividends);
    dividendBasicRateTax = basicBandDividends * incomeTax.dividendBasicRate;
    dividendHigherRateTax = higherBandDividends * incomeTax.dividendHigherRate;
    dividendAdditionalRateTax = additionalBandDividends * incomeTax.dividendAdditionalRate;
  }

  // Savings tax
  const savingsAllowance = incomeTax.savingsAllowance;
  const taxableSavings = Math.max(0, savingsIncome - savingsAllowance);
  
  const totalIncomeForSavingsBands = nonDividendSavingsIncome + dividendIncome + savingsIncome;
  let savingsBasicRateTax = 0;
  let savingsHigherRateTax = 0;

  if (totalIncomeForSavingsBands <= incomeTax.basicRate.threshold) {
    savingsBasicRateTax = taxableSavings * incomeTax.savingsBasicRate;
  } else {
    const basicBandSavings = Math.min(taxableSavings, incomeTax.basicRate.threshold - (totalIncomeForSavingsBands - savingsIncome));
    const higherBandSavings = Math.max(0, taxableSavings - basicBandSavings);
    savingsBasicRateTax = basicBandSavings * incomeTax.savingsBasicRate;
    savingsHigherRateTax = higherBandSavings * incomeTax.savingsHigherRate;
  }

  const totalTax = basicRateTax + higherRateTax + additionalRateTax +
    dividendBasicRateTax + dividendHigherRateTax + dividendAdditionalRateTax +
    savingsBasicRateTax + savingsHigherRateTax;

  return {
    taxableIncome,
    personalAllowance,
    basicRate: { income: basicRateIncome, tax: basicRateTax },
    higherRate: { income: higherRateIncome, tax: higherRateTax },
    additionalRate: { income: additionalRateIncome, tax: additionalRateTax },
    totalTax,
    effectiveRate: totalIncome > 0 ? totalTax / totalIncome : 0,
    dividends: {
      allowance: dividendAllowance,
      taxable: taxableDividends,
      basicRateTax: dividendBasicRateTax,
      higherRateTax: dividendHigherRateTax,
      additionalRateTax: dividendAdditionalRateTax,
      totalTax: dividendBasicRateTax + dividendHigherRateTax + dividendAdditionalRateTax,
    },
    savings: {
      allowance: savingsAllowance,
      taxable: taxableSavings,
      basicRateTax: savingsBasicRateTax,
      higherRateTax: savingsHigherRateTax,
      totalTax: savingsBasicRateTax + savingsHigherRateTax,
    },
  };
}

export async function calculateCorporationTax(
  tenantId: TenantId,
  profitBeforeTax: number,
  adjustments: number = 0
): Promise<CorporationTaxCalculation> {
  const profile = await getEntityTaxProfile(tenantId);

  if (!profile.corporationTax.applicable) {
    return {
      profitBeforeTax,
      adjustments,
      taxableProfit: 0,
      smallProfitsRate: 0,
      mainRate: 0,
      marginalRelief: 0,
      corporationTax: 0,
      effectiveRate: 0,
      afterTaxProfit: profitBeforeTax,
    };
  }

  const { corporationTax } = profile;
  const taxableProfit = profitBeforeTax + adjustments;

  let corporationTaxAmount = 0;
  let effectiveRate = 0;

  if (taxableProfit <= corporationTax.smallProfitsThreshold) {
    // Small profits rate
    corporationTaxAmount = taxableProfit * corporationTax.smallProfitsRate;
    effectiveRate = corporationTax.smallProfitsRate;
  } else if (taxableProfit >= corporationTax.marginalReliefUpperLimit) {
    // Main rate
    corporationTaxAmount = taxableProfit * corporationTax.mainRate;
    effectiveRate = corporationTax.mainRate;
  } else {
    // Marginal relief zone
    const mainRateTax = taxableProfit * corporationTax.mainRate;
    const marginalRelief = (corporationTax.marginalReliefUpperLimit - taxableProfit) *
      corporationTax.marginalReliefFraction *
      (corporationTax.mainRate - corporationTax.smallProfitsRate);
    corporationTaxAmount = mainRateTax - marginalRelief;
    effectiveRate = corporationTaxAmount / taxableProfit;
  }

  return {
    profitBeforeTax,
    adjustments,
    taxableProfit,
    smallProfitsRate: corporationTax.smallProfitsRate,
    mainRate: corporationTax.mainRate,
    marginalRelief: taxableProfit > corporationTax.smallProfitsThreshold && taxableProfit < corporationTax.marginalReliefUpperLimit
      ? (corporationTax.marginalReliefUpperLimit - taxableProfit) * corporationTax.marginalReliefFraction * (corporationTax.mainRate - corporationTax.smallProfitsRate)
      : 0,
    corporationTax: corporationTaxAmount,
    effectiveRate,
    afterTaxProfit: profitBeforeTax - corporationTaxAmount,
  };
}

export async function calculateNationalInsurance(
  tenantId: TenantId,
  profits: number,
  salary: number = 0,
  weeks: number = 52
): Promise<NationalInsuranceCalculation> {
  const profile = await getEntityTaxProfile(tenantId);

  // Class 2 (self-employed)
  let class2Amount = 0;
  if (profile.nationalInsurance.class2.weeklyRate > 0 && profits >= profile.nationalInsurance.class2.smallProfitsThreshold) {
    class2Amount = profile.nationalInsurance.class2.weeklyRate * weeks;
  }

  // Class 4 (self-employed on profits)
  let class4LowerBandTax = 0;
  let class4UpperBandTax = 0;
  if (profile.nationalInsurance.class4.lowerProfitsLimit > 0 && profits > profile.nationalInsurance.class4.lowerProfitsLimit) {
    const lowerBand = Math.min(profits - profile.nationalInsurance.class4.lowerProfitsLimit, 
      profile.nationalInsurance.class4.upperProfitsLimit - profile.nationalInsurance.class4.lowerProfitsLimit);
    const upperBand = Math.max(0, profits - profile.nationalInsurance.class4.upperProfitsLimit);
    
    class4LowerBandTax = lowerBand * profile.nationalInsurance.class4.lowerRate;
    class4UpperBandTax = upperBand * profile.nationalInsurance.class4.upperRate;
  }

  // Class 1 (employed)
  let class1Employee = 0;
  let class1Employer = 0;
  if (salary > 0 && profile.nationalInsurance.class1.employeeRate > 0) {
    const primaryThreshold = profile.nationalInsurance.class1.thresholds.primary;
    const upperThreshold = profile.nationalInsurance.class1.thresholds.upper;
    
    if (salary > primaryThreshold) {
      const taxableSalary = Math.min(salary - primaryThreshold, upperThreshold - primaryThreshold);
      const upperSalary = Math.max(0, salary - upperThreshold);
      
      class1Employee = taxableSalary * profile.nationalInsurance.class1.employeeRate;
      class1Employer = (taxableSalary + upperSalary) * profile.nationalInsurance.class1.employerRate;
    }
  }

  const total = class2Amount + class4LowerBandTax + class4UpperBandTax + class1Employee;

  return {
    class2: {
      applicable: profile.nationalInsurance.class2.weeklyRate > 0,
      weeks,
      amount: class2Amount,
    },
    class4: {
      applicable: profile.nationalInsurance.class4.lowerProfitsLimit > 0,
      lowerBand: class4LowerBandTax / profile.nationalInsurance.class4.lowerRate,
      upperBand: class4UpperBandTax / profile.nationalInsurance.class4.upperRate,
      lowerBandTax: class4LowerBandTax,
      upperBandTax: class4UpperBandTax,
      total: class4LowerBandTax + class4UpperBandTax,
    },
    class1: {
      employee: class1Employee,
      employer: class1Employer,
      total: class1Employee + class1Employer,
    },
    total,
  };
}

export async function calculateCapitalGainsTax(
  tenantId: TenantId,
  gains: number,
  losses: number = 0,
  isEntrepreneursRelief: boolean = false,
  entrepreneursReliefUsed: number = 0
): Promise<CapitalGainsTaxCalculation> {
  const profile = await getEntityTaxProfile(tenantId);

  if (!profile.capitalGainsTax.applicable) {
    return {
      gains,
      losses,
      netGains: 0,
      annualExemptAmount: 0,
      taxableGains: 0,
      basicRateTax: 0,
      higherRateTax: 0,
      entrepreneursRelief: {
        applicable: false,
        amount: 0,
        tax: 0,
      },
      totalTax: 0,
      effectiveRate: 0,
    };
  }

  const netGains = Math.max(0, gains - losses);
  const annualExemptAmount = profile.capitalGainsTax.annualExemptAmount;
  const taxableGains = Math.max(0, netGains - annualExemptAmount);

  let entrepreneursReliefAmount = 0;
  let entrepreneursReliefTax = 0;
  let remainingGains = taxableGains;

  if (isEntrepreneursRelief && taxableGains > 0) {
    const availableRelief = profile.capitalGainsTax.entrepreneursReliefLifetimeLimit - entrepreneursReliefUsed;
    entrepreneursReliefAmount = Math.min(taxableGains, availableRelief);
    entrepreneursReliefTax = entrepreneursReliefAmount * profile.capitalGainsTax.entrepreneursReliefRate;
    remainingGains = taxableGains - entrepreneursReliefAmount;
  }

  // CGT rates depend on income tax band (simplified - would need total income)
  // For now, assume higher rate if gains > threshold
  const basicRateTax = remainingGains * profile.capitalGainsTax.basicRate;
  const higherRateTax = 0; // Would calculate based on income tax band

  const totalTax = entrepreneursReliefTax + basicRateTax + higherRateTax;

  return {
    gains,
    losses,
    netGains,
    annualExemptAmount,
    taxableGains,
    basicRateTax,
    higherRateTax,
    entrepreneursRelief: {
      applicable: isEntrepreneursRelief,
      amount: entrepreneursReliefAmount,
      tax: entrepreneursReliefTax,
    },
    totalTax,
    effectiveRate: netGains > 0 ? totalTax / netGains : 0,
  };
}
