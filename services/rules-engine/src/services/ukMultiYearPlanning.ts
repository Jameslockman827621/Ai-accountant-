import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import { getEntityTaxProfile } from './ukTaxEntities';
import { calculateIncomeTax, calculateCorporationTax } from './ukTaxCalculations';
import { getHistoricalTaxRates } from './ukHistoricalTaxRates';

const logger = createLogger('rules-engine-service');

export interface MultiYearForecast {
  taxYear: string;
  projectedRevenue: number;
  projectedExpenses: number;
  projectedProfit: number;
  taxLiability: number;
  effectiveRate: number;
  assumptions: string[];
}

export interface MultiYearTaxPlan {
  tenantId: TenantId;
  currentYear: string;
  forecastYears: string[];
  forecasts: MultiYearForecast[];
  totalTaxLiability: number;
  averageEffectiveRate: number;
  recommendations: Array<{
    year: string;
    strategy: string;
    potentialSaving: number;
    implementation: string[];
  }>;
}

export async function generateMultiYearTaxPlan(
  tenantId: TenantId,
  years: number = 5,
  growthRate: number = 0.05
): Promise<MultiYearTaxPlan> {
  const profile = await getEntityTaxProfile(tenantId);
  const currentYear = profile.taxYear;
  const [startYear] = currentYear.split('-');
  const startYearNum = parseInt(startYear, 10);

  // Get current financial data
  const currentData = await getFinancialDataForYear(tenantId, currentYear);
  
  const forecasts: MultiYearForecast[] = [];
  const forecastYears: string[] = [];

  for (let i = 0; i < years; i++) {
    const yearNum = startYearNum + i;
    const taxYear = `${yearNum}-${String(yearNum + 1).slice(-2)}`;
    forecastYears.push(taxYear);

    // Project revenue and expenses
    const projectedRevenue = currentData.revenue * Math.pow(1 + growthRate, i);
    const projectedExpenses = currentData.expenses * Math.pow(1 + growthRate * 0.8, i); // Expenses grow slower
    const projectedProfit = projectedRevenue - projectedExpenses;

    // Get tax rates for this year (use historical if available, otherwise current)
    const yearRates = getHistoricalTaxRates(taxYear);
    const useProfile = yearRates ? { ...profile, ...yearRates } : profile;

    // Calculate tax liability
    let taxLiability = 0;
    if (useProfile.corporationTax.applicable) {
      const ct = await calculateCorporationTax(tenantId, projectedProfit);
      taxLiability = ct.corporationTax;
    } else {
      const it = await calculateIncomeTax(tenantId, projectedRevenue);
      taxLiability = it.totalTax;
    }

    const effectiveRate = projectedRevenue > 0 ? (taxLiability / projectedRevenue) * 100 : 0;

    forecasts.push({
      taxYear,
      projectedRevenue,
      projectedExpenses,
      projectedProfit,
      taxLiability,
      effectiveRate,
      assumptions: [
        `Revenue growth: ${(growthRate * 100).toFixed(1)}% per year`,
        `Expense growth: ${(growthRate * 0.8 * 100).toFixed(1)}% per year`,
        `Tax rates based on ${taxYear} rates`,
      ],
    });
  }

  const totalTaxLiability = forecasts.reduce((sum, f) => sum + f.taxLiability, 0);
  const averageEffectiveRate = forecasts.reduce((sum, f) => sum + f.effectiveRate, 0) / forecasts.length;

  // Generate recommendations
  const recommendations = generateYearlyRecommendations(forecasts, profile);

  return {
    tenantId,
    currentYear,
    forecastYears,
    forecasts,
    totalTaxLiability,
    averageEffectiveRate,
    recommendations,
  };
}

async function getFinancialDataForYear(tenantId: TenantId, taxYear: string): Promise<{
  revenue: number;
  expenses: number;
  profit: number;
}> {
  const [startYear] = taxYear.split('-');
  const yearStart = new Date(parseInt(startYear), 3, 6); // 6 April
  const yearEnd = new Date(parseInt(startYear) + 1, 3, 5); // 5 April

  const revenueResult = await db.query<{ revenue: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) as revenue
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'credit'
       AND account_code LIKE '4%'
       AND transaction_date >= $2
       AND transaction_date <= $3`,
    [tenantId, yearStart, yearEnd]
  );

  const expensesResult = await db.query<{ expenses: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) as expenses
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'debit'
       AND (account_code LIKE '5%' OR account_code LIKE '6%')
       AND transaction_date >= $2
       AND transaction_date <= $3`,
    [tenantId, yearStart, yearEnd]
  );

  const revenue = typeof revenueResult.rows[0]?.revenue === 'number'
    ? revenueResult.rows[0].revenue
    : parseFloat(String(revenueResult.rows[0]?.revenue || '0'));

  const expenses = typeof expensesResult.rows[0]?.expenses === 'number'
    ? expensesResult.rows[0].expenses
    : parseFloat(String(expensesResult.rows[0]?.expenses || '0'));

  return {
    revenue,
    expenses,
    profit: revenue - expenses,
  };
}

function generateYearlyRecommendations(
  forecasts: MultiYearForecast[],
  profile: any
): Array<{
  year: string;
  strategy: string;
  potentialSaving: number;
  implementation: string[];
}> {
  const recommendations: Array<{
    year: string;
    strategy: string;
    potentialSaving: number;
    implementation: string[];
  }> = [];

  for (const forecast of forecasts) {
    // Corporation Tax threshold optimization
    if (profile.corporationTax.applicable && forecast.projectedProfit > 50000 && forecast.projectedProfit < 250000) {
      recommendations.push({
        year: forecast.taxYear,
        strategy: 'Optimize profit to stay in small profits rate band',
        potentialSaving: forecast.projectedProfit * (profile.corporationTax.mainRate - profile.corporationTax.smallProfitsRate),
        implementation: [
          'Consider timing of income/expenses',
          'Maximize allowable deductions',
          'Consider pension contributions',
        ],
      });
    }

    // Income tax band optimization
    if (!profile.corporationTax.applicable && forecast.projectedRevenue > 50000) {
      recommendations.push({
        year: forecast.taxYear,
        strategy: 'Optimize income to minimize higher rate tax',
        potentialSaving: Math.max(0, forecast.projectedRevenue - 50270) * 0.20, // 20% saving on excess
        implementation: [
          'Consider pension contributions',
          'Use dividend allowance',
          'Time income recognition',
        ],
      });
    }
  }

  return recommendations;
}
