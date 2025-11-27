import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { EnhancedForecaster, ForecastResult } from '../enhancedForecasting';
import { getBaselineMetrics } from './scenarioPlanner';

const logger = createLogger('forecasting-models');

export interface ForecastingModelSummary {
  modelName: string;
  target: 'cash_flow' | 'runway' | 'tax_accruals';
  forecast: ForecastResult | null;
  businessSignals: string[];
  nextRetrainingAt?: Date;
}

export interface ForecastingPortfolio {
  cashFlow: ForecastingModelSummary;
  runway: ForecastingModelSummary;
  taxAccruals: ForecastingModelSummary;
}

export async function buildForecastingPortfolio(
  tenantId: TenantId,
  periods: number = 6
): Promise<ForecastingPortfolio> {
  const forecaster = new EnhancedForecaster();

  const [cashFlowForecast, baseline] = await Promise.all([
    forecaster
      .generateForecast({ tenantId, metric: 'cash_flow', periods, method: 'seasonal' })
      .catch(error => {
        logger.error('Cash flow forecast failed', error);
        return null;
      }),
    getBaselineMetrics(tenantId),
  ]);

  const runwayForecast = await buildRunwayProjection(forecaster, tenantId, baseline, periods);
  const taxAccrualForecast = await buildTaxAccrualForecast(forecaster, tenantId, periods);

  return {
    cashFlow: {
      modelName: 'cashflow_arima',
      target: 'cash_flow',
      forecast: cashFlowForecast,
      businessSignals: cashFlowForecast
        ? deriveSignalsFromForecast(cashFlowForecast, 'Cash flow')
        : ['Cash flow forecast unavailable; using historical cash balance trends.'],
      nextRetrainingAt: scheduleWindowFromNow(14),
    },
    runway: {
      modelName: 'runway_blended',
      target: 'runway',
      forecast: runwayForecast,
      businessSignals: runwayForecast
        ? deriveSignalsFromForecast(runwayForecast, 'Runway')
        : ['Runway estimate unavailable; confirm burn-rate inputs.'],
      nextRetrainingAt: scheduleWindowFromNow(7),
    },
    taxAccruals: {
      modelName: 'tax_accrual_curve',
      target: 'tax_accruals',
      forecast: taxAccrualForecast,
      businessSignals: taxAccrualForecast
        ? deriveSignalsFromForecast(taxAccrualForecast, 'Tax accruals')
        : ['Tax accrual forecast unavailable; reconcile VAT/PAYE balances.'],
      nextRetrainingAt: scheduleWindowFromNow(30),
    },
  };
}

async function buildRunwayProjection(
  forecaster: EnhancedForecaster,
  tenantId: TenantId,
  baseline: Awaited<ReturnType<typeof getBaselineMetrics>>,
  periods: number
): Promise<ForecastResult | null> {
  if (!Number.isFinite(baseline.cashOnHand) || baseline.cashOnHand <= 0) {
    return null;
  }

  const burnRate = Math.max(0.01, baseline.monthlyBurn || 0.01);
  const derivedRunway = Math.max(1, Math.round(baseline.cashOnHand / burnRate));

  const syntheticSeries = Array.from({ length: 12 }, () => baseline.cashOnHand - burnRate);
  try {
    const forecast = await forecaster.generateForecast({
      tenantId,
      metric: 'cash_flow',
      periods,
      method: 'linear',
      historicalPeriods: syntheticSeries.length,
    });

    forecast.periods = forecast.periods.map((period, index) => ({
      ...period,
      forecast: Math.max(0, baseline.cashOnHand - burnRate * (index + 1)),
    }));

    forecast.trend = derivedRunway < 6 ? 'decreasing' : forecast.trend;

    return forecast;
  } catch (error) {
    logger.error('Runway projection failed', error);
    return null;
  }
}

async function buildTaxAccrualForecast(
  forecaster: EnhancedForecaster,
  tenantId: TenantId,
  periods: number
): Promise<ForecastResult | null> {
  try {
    const historicalAccruals = await db.query<{ amount: string | number }>(
      `SELECT COALESCE(SUM(amount), 0) AS amount
       FROM ledger_entries
       WHERE tenant_id = $1
         AND account_code LIKE '2%'
         AND transaction_date >= NOW() - INTERVAL '12 months'
       GROUP BY DATE_TRUNC('quarter', transaction_date)
       ORDER BY DATE_TRUNC('quarter', transaction_date) DESC
       LIMIT 8`,
      [tenantId]
    );

    if (historicalAccruals.rows.length === 0) {
      return null;
    }

    const accrualSeries = historicalAccruals.rows
      .reverse()
      .map(row => (typeof row.amount === 'number' ? row.amount : parseFloat(String(row.amount || '0'))));

    const forecast = await forecaster.generateForecast({
      tenantId,
      metric: 'cash_flow',
      periods,
      method: 'exponential',
      historicalPeriods: accrualSeries.length,
    });

    forecast.metric = 'tax_accruals';
    forecast.periods = forecast.periods.map(p => ({
      ...p,
      forecast: Math.max(0, p.forecast),
    }));

    return forecast;
  } catch (error) {
    logger.error('Tax accrual forecast failed', error);
    return null;
  }
}

function deriveSignalsFromForecast(forecast: ForecastResult, label: string): string[] {
  const latest = forecast.periods.at(-1);
  const direction = forecast.trend === 'increasing' ? 'upward' : forecast.trend === 'decreasing' ? 'downward' : 'flat';
  const confidence = Math.round((latest?.confidence ?? 0) * 100);
  const bounds = latest
    ? `CI £${latest.lowerBound.toFixed(2)} - £${latest.upperBound.toFixed(2)}`
    : 'No bounds available';

  return [
    `${label} trend: ${direction} with ${confidence}% confidence`,
    bounds,
    forecast.seasonality?.detected
      ? `Seasonality detected (period ${forecast.seasonality.period}): strength ${(forecast.seasonality.strength * 100).toFixed(1)}%`
      : 'No strong seasonality detected',
  ];
}

function scheduleWindowFromNow(days: number): Date {
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next;
}
