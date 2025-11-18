import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('analytics-service');

export interface ScenarioAdjustments {
  revenueDeltaPct?: number;
  expenseDeltaPct?: number;
  cashInjection?: number;
  oneTimeExpense?: number;
  hiringPlan?: number;
  avgHireCost?: number;
  dividendPayout?: number;
}

export interface DividendPlan {
  salaryPerMonth?: number;
  dividendPerMonth?: number;
}

export interface ScenarioInput {
  horizonMonths?: number;
  adjustments?: ScenarioAdjustments;
  dividendPlan?: DividendPlan;
}

export interface ScenarioResult {
  baseline: BaselineMetrics;
  scenario: ScenarioProjection;
  dividendComparison?: DividendComparison;
}

export interface BaselineMetrics {
  monthlyRevenue: number;
  monthlyExpenses: number;
  monthlyBurn: number;
  cashOnHand: number;
  runwayMonths: number;
}

export interface ScenarioProjection {
  monthlyRevenue: number;
  monthlyExpenses: number;
  monthlyBurn: number;
  cashStart: number;
  cashProjection: Array<{ month: number; cash: number }>;
  runwayMonths: number;
  warnings: string[];
  insights: string[];
}

export interface DividendComparison {
  salaryNet: number;
  dividendNet: number;
  estimatedSavings: number;
  recommendation: string;
}

const DEFAULT_HORIZON = 12;

export async function runScenarioAnalysis(
  tenantId: TenantId,
  input?: ScenarioInput
): Promise<ScenarioResult> {
  const horizon = Math.max(3, Math.min(input?.horizonMonths ?? DEFAULT_HORIZON, 36));
  const adjustments = input?.adjustments ?? {};
  logger.info('Running scenario planner', { tenantId, horizon, adjustments });

  const baseline = await getBaselineMetrics(tenantId);

  const scenario = buildScenario(baseline, horizon, adjustments);
  const dividendComparison = input?.dividendPlan
    ? compareDividendsVsSalary(input.dividendPlan)
    : undefined;

  const result: ScenarioResult = {
    baseline,
    scenario,
  };

  if (dividendComparison) {
    result.dividendComparison = dividendComparison;
  }

  return result;
}

export async function getBaselineMetrics(tenantId: TenantId): Promise<BaselineMetrics> {
  const [revenueRow, expenseRow, cashRow] = await Promise.all([
    db.query<{ total: string | number | null }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM ledger_entries
       WHERE tenant_id = $1
         AND entry_type = 'credit'
         AND account_code LIKE '4%'
         AND transaction_date >= NOW() - INTERVAL '90 days'`,
      [tenantId]
    ),
    db.query<{ total: string | number | null }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM ledger_entries
       WHERE tenant_id = $1
         AND entry_type = 'debit'
         AND (account_code LIKE '5%' OR account_code LIKE '6%')
         AND transaction_date >= NOW() - INTERVAL '90 days'`,
      [tenantId]
    ),
    db.query<{ balance: string | number | null }>(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END), 0) AS balance
       FROM ledger_entries
       WHERE tenant_id = $1
         AND account_code LIKE '1%'`,
      [tenantId]
    ),
  ]);

  const quarterlyRevenue = parseDbNumber(revenueRow.rows[0]?.total);
  const quarterlyExpenses = parseDbNumber(expenseRow.rows[0]?.total);
  const cashOnHand = Math.max(0, parseDbNumber(cashRow.rows[0]?.balance));

  const monthlyRevenue = roundCurrency(quarterlyRevenue / 3);
  const monthlyExpenses = roundCurrency(quarterlyExpenses / 3);
  const monthlyBurn = Math.max(0, roundCurrency(monthlyExpenses - monthlyRevenue));
  const runwayMonths = monthlyBurn > 0 ? roundCurrency(cashOnHand / monthlyBurn) : Infinity;

  return {
    monthlyRevenue,
    monthlyExpenses,
    monthlyBurn,
    cashOnHand,
    runwayMonths,
  };
}

function buildScenario(
  baseline: BaselineMetrics,
  horizon: number,
  adjustments: ScenarioAdjustments
): ScenarioProjection {
  const revenueMultiplier = 1 + (adjustments.revenueDeltaPct ?? 0) / 100;
  const expenseMultiplier = 1 + (adjustments.expenseDeltaPct ?? 0) / 100;
  const hiringCost = (adjustments.hiringPlan ?? 0) * (adjustments.avgHireCost ?? 4500);
  const dividendPayout = adjustments.dividendPayout ?? 0;

  const scenarioRevenue = roundCurrency(baseline.monthlyRevenue * revenueMultiplier);
  const scenarioExpenses = roundCurrency(baseline.monthlyExpenses * expenseMultiplier + hiringCost);
  const monthlyBurn = Math.max(0, roundCurrency(scenarioExpenses - scenarioRevenue));

  let cash =
    baseline.cashOnHand + (adjustments.cashInjection ?? 0) - (adjustments.oneTimeExpense ?? 0);
  const projections: Array<{ month: number; cash: number }> = [];
  const warnings: string[] = [];
  const insights: string[] = [];

  for (let month = 1; month <= horizon; month++) {
    if (month === 1 && dividendPayout > 0) {
      cash -= dividendPayout;
    }
    cash += scenarioRevenue - scenarioExpenses;
    projections.push({ month, cash: roundCurrency(cash) });
  }

  const runwayMonths = monthlyBurn > 0 ? roundCurrency(cash / monthlyBurn) : Infinity;

  if (monthlyBurn <= 0) {
    insights.push('Scenario creates a surplus each month; consider reinvesting excess cash.');
  } else if (!Number.isFinite(runwayMonths) || runwayMonths > horizon * 2) {
    insights.push('Cash reserves cover more than two horizons; explore growth investments.');
  } else if (runwayMonths < 6) {
    warnings.push('Runway drops below 6 months. Consider increasing revenue or reducing spend.');
  }

  if ((adjustments.cashInjection ?? 0) > 0) {
    insights.push(
      `Cash injection of £${formatCurrency(adjustments.cashInjection ?? 0)} applied in month 1.`
    );
  }
  if ((adjustments.hiringPlan ?? 0) > 0) {
    insights.push(
      `Hiring plan adds ${adjustments.hiringPlan ?? 0} heads at approx £${formatCurrency(adjustments.avgHireCost ?? 4500)} per month each.`
    );
  }

  return {
    monthlyRevenue: scenarioRevenue,
    monthlyExpenses: scenarioExpenses,
    monthlyBurn,
    cashStart: roundCurrency(baseline.cashOnHand),
    cashProjection: projections,
    runwayMonths,
    warnings,
    insights,
  };
}

function compareDividendsVsSalary(plan: DividendPlan): DividendComparison {
  const salary = plan.salaryPerMonth ?? 0;
  const dividend = plan.dividendPerMonth ?? 0;

  const salaryNet = roundCurrency(salary * 0.62); // approx PAYE + NI
  const dividendTaxRate = dividend <= 5000 ? 0.0875 : dividend <= 50000 ? 0.3375 : 0.3935;
  const dividendNet = roundCurrency(dividend * (1 - dividendTaxRate));
  const estimatedSavings = roundCurrency(Math.max(0, dividendNet - salaryNet));

  const recommendation =
    dividendNet > salaryNet
      ? 'Consider shifting part of compensation to dividends to improve take-home pay.'
      : 'Salary route currently provides similar or better net income.';

  return {
    salaryNet,
    dividendNet,
    estimatedSavings,
    recommendation,
  };
}

function parseDbNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-GB', { minimumFractionDigits: 0 });
}
