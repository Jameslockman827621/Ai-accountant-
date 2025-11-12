import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getEntityTaxProfile } from './ukTaxEntities';
import { calculateIncomeTax } from './ukTaxCalculations';

const logger = createLogger('rules-engine-service');

export interface PensionContribution {
  employee: number;
  employer: number;
  total: number;
  taxYear: string;
}

export interface PensionTaxRelief {
  contribution: number;
  basicRateRelief: number;
  higherRateRelief: number;
  additionalRateRelief: number;
  totalRelief: number;
  netCost: number;
}

export interface PensionCalculation {
  taxYear: string;
  annualAllowance: number;
  lifetimeAllowance: number;
  contributions: PensionContribution;
  taxRelief: PensionTaxRelief;
  allowanceUsed: number;
  allowanceRemaining: number;
  lifetimeUsed: number;
  lifetimeRemaining: number;
  taxCharge: number;
  recommendations: string[];
}

// Pension Annual Allowance by Tax Year
const PENSION_ALLOWANCES: Record<string, { annual: number; lifetime: number }> = {
  '2024-25': { annual: 60000, lifetime: 1073100 },
  '2023-24': { annual: 60000, lifetime: 1073100 },
  '2022-23': { annual: 40000, lifetime: 1073100 },
  '2021-22': { annual: 40000, lifetime: 1073100 },
};

// Tapered Annual Allowance thresholds
const TAPERED_ALLOWANCE_THRESHOLD = 260000; // Adjusted income
const TAPERED_ALLOWANCE_MINIMUM = 10000; // Minimum after tapering

export async function calculatePensionTaxRelief(
  tenantId: TenantId,
  contribution: number,
  isEmployerContribution: boolean = false,
  adjustedIncome: number = 0
): Promise<PensionTaxRelief> {
  const profile = await getEntityTaxProfile(tenantId);
  const { incomeTax } = profile;

  if (!isEmployerContribution) {
    // Employee contributions get tax relief
    // Basic rate relief at source (20%)
    const basicRateRelief = contribution * incomeTax.basicRate.rate;
    
    // Higher/additional rate relief via tax return
    let higherRateRelief = 0;
    let additionalRateRelief = 0;

    if (adjustedIncome > incomeTax.basicRate.threshold) {
      const higherBandContribution = Math.min(
        contribution,
        adjustedIncome - incomeTax.basicRate.threshold
      );
      higherRateRelief = higherBandContribution * (incomeTax.higherRate.rate - incomeTax.basicRate.rate);
    }

    if (adjustedIncome > incomeTax.higherRate.threshold) {
      const additionalBandContribution = Math.min(
        contribution,
        adjustedIncome - incomeTax.higherRate.threshold
      );
      additionalRateRelief = additionalBandContribution * (incomeTax.additionalRate.rate - incomeTax.basicRate.rate);
    }

    const totalRelief = basicRateRelief + higherRateRelief + additionalRateRelief;
    const netCost = contribution - totalRelief;

    return {
      contribution,
      basicRateRelief,
      higherRateRelief,
      additionalRateRelief,
      totalRelief,
      netCost,
    };
  } else {
    // Employer contributions - no tax relief for employee, but employer gets corporation tax relief
    return {
      contribution,
      basicRateRelief: 0,
      higherRateRelief: 0,
      additionalRateRelief: 0,
      totalRelief: 0,
      netCost: contribution,
    };
  }
}

export async function calculatePensionAllowance(
  tenantId: TenantId,
  taxYear: string,
  contributions: PensionContribution,
  previousContributions: number = 0,
  lifetimeContributions: number = 0,
  adjustedIncome: number = 0
): Promise<PensionCalculation> {
  const allowances = PENSION_ALLOWANCES[taxYear] || PENSION_ALLOWANCES['2024-25'];
  let annualAllowance = allowances.annual;

  // Tapered annual allowance for high earners
  if (adjustedIncome >= TAPERED_ALLOWANCE_THRESHOLD) {
    const excess = adjustedIncome - TAPERED_ALLOWANCE_THRESHOLD;
    const reduction = Math.floor(excess / 2) * 1000; // £1,000 reduction per £2,000 over threshold
    annualAllowance = Math.max(TAPERED_ALLOWANCE_MINIMUM, annualAllowance - reduction);
  }

  const totalContributions = contributions.employee + contributions.employer;
  const allowanceUsed = previousContributions + totalContributions;
  const allowanceRemaining = Math.max(0, annualAllowance - allowanceUsed);
  const excessContributions = Math.max(0, allowanceUsed - annualAllowance);

  // Tax charge on excess contributions
  let taxCharge = 0;
  if (excessContributions > 0) {
    // Charge at marginal rate
    const profile = await getEntityTaxProfile(tenantId);
    const taxCalculation = await calculateIncomeTax(tenantId, adjustedIncome);
    const marginalRate = adjustedIncome > profile.incomeTax.higherRate.threshold
      ? profile.incomeTax.additionalRate.rate
      : adjustedIncome > profile.incomeTax.basicRate.threshold
      ? profile.incomeTax.higherRate.rate
      : profile.incomeTax.basicRate.rate;
    
    taxCharge = excessContributions * marginalRate;
  }

  // Lifetime allowance
  const lifetimeUsed = lifetimeContributions;
  const lifetimeRemaining = Math.max(0, allowances.lifetime - lifetimeUsed);

  // Tax relief calculation
  const taxRelief = await calculatePensionTaxRelief(tenantId, contributions.employee, false, adjustedIncome);

  const recommendations: string[] = [];
  if (excessContributions > 0) {
    recommendations.push(`Reduce contributions by £${excessContributions.toLocaleString()} to avoid annual allowance charge`);
  }
  if (lifetimeUsed > allowances.lifetime * 0.9) {
    recommendations.push('Approaching lifetime allowance - consider alternative savings');
  }
  if (allowanceRemaining > 0 && adjustedIncome > 50000) {
    recommendations.push(`Consider increasing contributions to maximize tax relief (up to £${allowanceRemaining.toLocaleString()} remaining)`);
  }

  return {
    taxYear,
    annualAllowance,
    lifetimeAllowance: allowances.lifetime,
    contributions,
    taxRelief,
    allowanceUsed,
    allowanceRemaining,
    lifetimeUsed,
    lifetimeRemaining,
    taxCharge,
    recommendations,
  };
}

export async function calculateOptimalPensionContribution(
  tenantId: TenantId,
  taxYear: string,
  income: number,
  existingContributions: number = 0
): Promise<{
  recommendedContribution: number;
  taxSaving: number;
  netCost: number;
  reasoning: string;
}> {
  const allowances = PENSION_ALLOWANCES[taxYear] || PENSION_ALLOWANCES['2024-25'];
  const availableAllowance = allowances.annual - existingContributions;

  // Calculate optimal contribution
  let recommendedContribution = Math.min(availableAllowance, income * 0.25); // Up to 25% of income or remaining allowance

  // For high earners, consider tapered allowance
  if (income >= TAPERED_ALLOWANCE_THRESHOLD) {
    const excess = income - TAPERED_ALLOWANCE_THRESHOLD;
    const reduction = Math.floor(excess / 2) * 1000;
    const taperedAllowance = Math.max(TAPERED_ALLOWANCE_MINIMUM, allowances.annual - reduction);
    recommendedContribution = Math.min(recommendedContribution, taperedAllowance - existingContributions);
  }

  const taxRelief = await calculatePensionTaxRelief(tenantId, recommendedContribution, false, income);
  const taxSaving = taxRelief.totalRelief;
  const netCost = taxRelief.netCost;

  const reasoning = `Contribute £${recommendedContribution.toLocaleString()} to maximize tax relief. ` +
    `This will save £${taxSaving.toLocaleString()} in tax at a net cost of £${netCost.toLocaleString()}.`;

  return {
    recommendedContribution,
    taxSaving,
    netCost,
    reasoning,
  };
}
