import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getEntityTaxProfile } from './ukTaxEntities';
import { generateTaxOptimizationReport } from './ukTaxOptimization';

const logger = createLogger('rules-engine-service');

export interface Scenario {
  name: string;
  parameters: Record<string, unknown>;
  projectedSavings: number;
  riskLevel: 'low' | 'medium' | 'high';
  implementationComplexity: 'simple' | 'moderate' | 'complex';
}

export interface ScenarioAnalysis {
  baseScenario: {
    currentTaxLiability: number;
    currentEffectiveRate: number;
  };
  scenarios: Scenario[];
  recommendations: Array<{
    scenario: string;
    priority: 'high' | 'medium' | 'low';
    reasoning: string;
    estimatedSavings: number;
    implementationSteps: string[];
  }>;
}

/**
 * Advanced tax optimization with scenario planning
 */
export async function generateTaxOptimizationScenarios(
  tenantId: TenantId,
  currentYearIncome: number,
  currentYearExpenses: number,
  projections: {
    nextYearIncome?: number;
    nextYearExpenses?: number;
    plannedInvestments?: number;
    plannedPensionContributions?: number;
  } = {}
): Promise<ScenarioAnalysis> {
  logger.info('Generating tax optimization scenarios', { tenantId });

  const profile = await getEntityTaxProfile(tenantId);
  const baseReport = await generateTaxOptimizationReport(tenantId);

  // Calculate current tax liability
  const currentTaxLiability = calculateCurrentTaxLiability(
    currentYearIncome,
    currentYearExpenses,
    profile
  );
  const currentEffectiveRate = currentYearIncome > 0
    ? currentTaxLiability / currentYearIncome
    : 0;

  // Generate scenarios
  const scenarios: Scenario[] = [];

  // Scenario 1: Increase pension contributions
  if (projections.plannedPensionContributions) {
    const pensionScenario = calculatePensionScenario(
      currentYearIncome,
      projections.plannedPensionContributions,
      profile
    );
    scenarios.push(pensionScenario);
  }

  // Scenario 2: Salary vs Dividend optimization (for companies)
  if (profile.entityType === 'ltd' || profile.entityType === 'plc') {
    const salaryDividendScenario = calculateSalaryDividendScenario(
      currentYearIncome,
      profile
    );
    scenarios.push(salaryDividendScenario);
  }

  // Scenario 3: Timing optimization
  const timingScenario = calculateTimingScenario(
    currentYearIncome,
    currentYearExpenses,
    projections.nextYearIncome,
    profile
  );
  scenarios.push(timingScenario);

  // Scenario 4: R&D tax relief
  if (projections.plannedInvestments) {
    const rndScenario = calculateRNDScenario(
      projections.plannedInvestments,
      profile
    );
    scenarios.push(rndScenario);
  }

  // Generate recommendations
  const recommendations = scenarios
    .map(scenario => ({
      scenario: scenario.name,
      priority: scenario.projectedSavings > 5000 ? 'high' as const :
        scenario.projectedSavings > 1000 ? 'medium' as const : 'low' as const,
      reasoning: `Potential savings of £${scenario.projectedSavings.toLocaleString()} with ${scenario.riskLevel} risk`,
      estimatedSavings: scenario.projectedSavings,
      implementationSteps: generateImplementationSteps(scenario),
    }))
    .sort((a, b) => b.estimatedSavings - a.estimatedSavings);

  return {
    baseScenario: {
      currentTaxLiability,
      currentEffectiveRate,
    },
    scenarios,
    recommendations,
  };
}

function calculateCurrentTaxLiability(
  income: number,
  expenses: number,
  profile: ReturnType<typeof getEntityTaxProfile> extends Promise<infer T> ? T : never
): number {
  const profit = income - expenses;
  // Simplified calculation - in production use full tax calculation
  if (profile.entityType === 'ltd' || profile.entityType === 'plc') {
    return profit * (profile.corporationTax.mainRate || 0.25);
  } else {
    // Income tax calculation
    const { incomeTax } = profile;
    const taxableIncome = Math.max(0, profit - (incomeTax.personalAllowance || 0));
    if (taxableIncome <= 0) return 0;
    
    let tax = 0;
    if (taxableIncome <= incomeTax.basicRate.threshold) {
      tax = taxableIncome * incomeTax.basicRate.rate;
    } else if (taxableIncome <= incomeTax.higherRate.threshold) {
      tax = incomeTax.basicRate.threshold * incomeTax.basicRate.rate +
        (taxableIncome - incomeTax.basicRate.threshold) * incomeTax.higherRate.rate;
    } else {
      tax = incomeTax.basicRate.threshold * incomeTax.basicRate.rate +
        (incomeTax.higherRate.threshold - incomeTax.basicRate.threshold) * incomeTax.higherRate.rate +
        (taxableIncome - incomeTax.higherRate.threshold) * incomeTax.additionalRate.rate;
    }
    return tax;
  }
}

function calculatePensionScenario(
  income: number,
  pensionContribution: number,
  profile: ReturnType<typeof getEntityTaxProfile> extends Promise<infer T> ? T : never
): Scenario {
  const taxRelief = pensionContribution * (profile.incomeTax.basicRate.rate || 0.20);
  return {
    name: 'Increase Pension Contributions',
    parameters: { pensionContribution },
    projectedSavings: taxRelief,
    riskLevel: 'low',
    implementationComplexity: 'simple',
  };
}

function calculateSalaryDividendScenario(
  income: number,
  profile: ReturnType<typeof getEntityTaxProfile> extends Promise<infer T> ? T : never
): Scenario {
  // Optimal split calculation (simplified)
  const optimalSalary = 12570; // Personal allowance
  const remainingAsDividend = income - optimalSalary;
  const dividendTax = remainingAsDividend * (profile.incomeTax.dividendBasicRate || 0.0875);
  const salaryTax = 0; // Within personal allowance
  
  const currentTax = income * 0.20; // Simplified
  const savings = currentTax - (salaryTax + dividendTax);

  return {
    name: 'Salary vs Dividend Optimization',
    parameters: { salary: optimalSalary, dividends: remainingAsDividend },
    projectedSavings: Math.max(0, savings),
    riskLevel: 'low',
    implementationComplexity: 'moderate',
  };
}

function calculateTimingScenario(
  currentIncome: number,
  currentExpenses: number,
  nextYearIncome: number | undefined,
  profile: ReturnType<typeof getEntityTaxProfile> extends Promise<infer T> ? T : never
): Scenario {
  if (!nextYearIncome) {
    return {
      name: 'Income/Expense Timing',
      parameters: {},
      projectedSavings: 0,
      riskLevel: 'low',
      implementationComplexity: 'simple',
    };
  }

  // Defer income or accelerate expenses if next year has lower tax rate
  const currentRate = profile.incomeTax.basicRate.rate || 0.20;
  const savings = currentIncome * 0.05; // Simplified

  return {
    name: 'Income/Expense Timing Optimization',
    parameters: { deferIncome: true, accelerateExpenses: true },
    projectedSavings: savings,
    riskLevel: 'medium',
    implementationComplexity: 'moderate',
  };
}

function calculateRNDScenario(
  investment: number,
  profile: ReturnType<typeof getEntityTaxProfile> extends Promise<infer T> ? T : never
): Scenario {
  const relief = investment * (profile.reliefs.rndSmeRate || 1.86);
  return {
    name: 'R&D Tax Relief',
    parameters: { investment },
    projectedSavings: relief,
    riskLevel: 'low',
    implementationComplexity: 'complex',
  };
}

function generateImplementationSteps(scenario: Scenario): string[] {
  const steps: string[] = [];

  switch (scenario.name) {
    case 'Increase Pension Contributions':
      steps.push('Set up pension scheme if not already done');
      steps.push(`Make contribution of £${(scenario.parameters.pensionContribution as number).toLocaleString()}`);
      steps.push('Claim tax relief through self-assessment or PAYE');
      break;
    case 'Salary vs Dividend Optimization':
      steps.push('Review current salary/dividend split');
      steps.push('Adjust salary to optimal level');
      steps.push('Pay remaining as dividends');
      steps.push('Update PAYE records');
      break;
    case 'Income/Expense Timing Optimization':
      steps.push('Identify income that can be deferred');
      steps.push('Identify expenses that can be accelerated');
      steps.push('Plan timing of transactions');
      break;
    case 'R&D Tax Relief':
      steps.push('Identify qualifying R&D activities');
      steps.push('Document R&D expenditure');
      steps.push('Prepare R&D claim with technical narrative');
      steps.push('Submit claim to HMRC');
      break;
  }

  return steps;
}
