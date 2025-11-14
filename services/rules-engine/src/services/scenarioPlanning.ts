import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getEntityTaxProfile } from './ukTaxEntities';
import { calculateIncomeTax } from './ukTaxCalculations';
import { calculateCorporationTax } from './ukTaxCalculations';
import { generateTaxOptimizationReport } from './ukTaxOptimization';

const logger = createLogger('rules-engine-service');

export interface TaxScenario {
  id: string;
  name: string;
  description: string;
  assumptions: Record<string, unknown>;
  projectedIncome: number;
  projectedExpenses: number;
  entityType: string;
  taxYear: string;
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioName: string;
  incomeTax: number;
  corporationTax: number;
  nationalInsurance: number;
  totalTaxLiability: number;
  netIncome: number;
  taxOptimizations: Array<{
    strategy: string;
    potentialSaving: number;
    implementation: string;
  }>;
  comparison: {
    baseline: number;
    scenario: number;
    difference: number;
    percentageChange: number;
  };
}

/**
 * Advanced tax scenario planning with what-if analysis
 */
export async function planTaxScenarios(
  tenantId: TenantId,
  scenarios: TaxScenario[],
  baselineScenario?: TaxScenario
): Promise<ScenarioResult[]> {
  logger.info('Planning tax scenarios', { tenantId, scenarioCount: scenarios.length });

  const results: ScenarioResult[] = [];

  // Calculate baseline if provided
  let baselineResult: ScenarioResult | null = null;
  if (baselineScenario) {
    baselineResult = await calculateScenario(tenantId, baselineScenario);
  }

  // Calculate each scenario
  for (const scenario of scenarios) {
    const result = await calculateScenario(tenantId, scenario);

    // Compare with baseline
    if (baselineResult) {
      result.comparison = {
        baseline: baselineResult.totalTaxLiability,
        scenario: result.totalTaxLiability,
        difference: result.totalTaxLiability - baselineResult.totalTaxLiability,
        percentageChange:
          ((result.totalTaxLiability - baselineResult.totalTaxLiability) / baselineResult.totalTaxLiability) * 100,
      };
    }

    results.push(result);
  }

  return results;
}

async function calculateScenario(
  tenantId: TenantId,
  scenario: TaxScenario
): Promise<ScenarioResult> {
  const profile = await getEntityTaxProfile(tenantId);
  const profit = scenario.projectedIncome - scenario.projectedExpenses;

  // Calculate taxes based on entity type
  let incomeTax = 0;
  let corporationTax = 0;
  let nationalInsurance = 0;

  if (profile.entityType === 'sole_trader' || profile.entityType === 'freelancer') {
    incomeTax = calculateIncomeTax(profit, profile, scenario.taxYear);
    // Calculate NI
    if (profit > profile.nationalInsurance.class4.lowerProfitsLimit) {
      const class4Lower = Math.min(profit, profile.nationalInsurance.class4.upperProfitsLimit) - profile.nationalInsurance.class4.lowerProfitsLimit;
      const class4Upper = Math.max(0, profit - profile.nationalInsurance.class4.upperProfitsLimit);
      nationalInsurance = class4Lower * profile.nationalInsurance.class4.lowerRate + class4Upper * profile.nationalInsurance.class4.upperRate;
    }
  } else if (profile.entityType === 'ltd' || profile.entityType === 'plc') {
    corporationTax = calculateCorporationTax(profit, profile);
  }

  const totalTaxLiability = incomeTax + corporationTax + nationalInsurance;
  const netIncome = profit - totalTaxLiability;

  // Get optimization strategies
  const optimizations = await generateTaxOptimizationReport(tenantId, {
    currentIncome: scenario.projectedIncome,
    currentExpenses: scenario.projectedExpenses,
    entityType: profile.entityType,
  });

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    incomeTax,
    corporationTax,
    nationalInsurance,
    totalTaxLiability,
    netIncome,
    taxOptimizations: optimizations.strategies.map(s => ({
      strategy: s.strategy,
      potentialSaving: s.potentialSaving,
      implementation: s.implementation,
    })),
    comparison: {
      baseline: 0,
      scenario: totalTaxLiability,
      difference: 0,
      percentageChange: 0,
    },
  };
}

/**
 * Compare multiple scenarios side-by-side
 */
export async function compareScenarios(
  tenantId: TenantId,
  scenarios: TaxScenario[]
): Promise<{
  scenarios: ScenarioResult[];
  bestScenario: ScenarioResult | null;
  worstScenario: ScenarioResult | null;
  recommendations: string[];
}> {
  const results = await planTaxScenarios(tenantId, scenarios);

  const bestScenario = results.reduce((best, current) =>
    current.totalTaxLiability < best.totalTaxLiability ? current : best,
    results[0]
  );

  const worstScenario = results.reduce((worst, current) =>
    current.totalTaxLiability > worst.totalTaxLiability ? current : worst,
    results[0]
  );

  const recommendations: string[] = [];
  if (bestScenario && worstScenario) {
    const saving = worstScenario.totalTaxLiability - bestScenario.totalTaxLiability;
    recommendations.push(
      `Best scenario "${bestScenario.scenarioName}" saves £${saving.toFixed(2)} compared to worst scenario`
    );

    // Add optimization recommendations
    for (const opt of bestScenario.taxOptimizations.slice(0, 3)) {
      recommendations.push(`${opt.strategy}: Potential saving of £${opt.potentialSaving.toFixed(2)}`);
    }
  }

  return {
    scenarios: results,
    bestScenario: bestScenario || null,
    worstScenario: worstScenario || null,
    recommendations,
  };
}
