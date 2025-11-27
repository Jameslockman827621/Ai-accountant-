import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { ModelRegistryService, ModelPerformance } from './modelRegistry';
import { buildForecastingPortfolio } from '@ai-accountant/analytics-service/services/forecastingModels';
import { ForecastResult } from '@ai-accountant/analytics-service/enhancedForecasting';

const logger = createLogger('forecasting-lifecycle');
const registry = new ModelRegistryService();

export interface ForecastingModelHealth {
  modelName: string;
  version: string;
  lastScore: ModelPerformance;
  driftDetected: boolean;
  recommendedAction: string;
}

export async function registerForecastingModels(
  tenantId: TenantId,
  version: string
): Promise<void> {
  const portfolio = await buildForecastingPortfolio(tenantId, 6);

  await Promise.all([
    registry.registerModel({
      modelName: 'cashflow_arima',
      modelVersion: version,
      modelType: 'forecasting',
      trainingDataHash: 'cashflow-ledger-window',
      metrics: portfolio.cashFlow.forecast?.accuracy || {},
      hyperparameters: { method: portfolio.cashFlow.forecast?.trend, horizon: portfolio.cashFlow.forecast?.periods.length },
      rolloutStage: 'staging',
    }),
    registry.registerModel({
      modelName: 'runway_blended',
      modelVersion: version,
      modelType: 'forecasting',
      trainingDataHash: 'cash-burn-blended',
      metrics: portfolio.runway.forecast?.accuracy || {},
      hyperparameters: { horizon: portfolio.runway.forecast?.periods.length },
      rolloutStage: 'staging',
    }),
    registry.registerModel({
      modelName: 'tax_accrual_curve',
      modelVersion: version,
      modelType: 'forecasting',
      trainingDataHash: 'tax-ledger-trailing-quarters',
      metrics: portfolio.taxAccruals.forecast?.accuracy || {},
      hyperparameters: { method: 'exponential' },
      rolloutStage: 'staging',
    }),
  ]);

  logger.info('Forecasting models registered', { tenantId, version });
}

export async function evaluateForecastingModels(
  tenantId: TenantId,
  version: string
): Promise<ForecastingModelHealth[]> {
  const portfolio = await buildForecastingPortfolio(tenantId, 3);
  const scores: ForecastingModelHealth[] = [];

  const addScore = (modelName: string, forecast: ForecastResult | null | undefined, trend: string | undefined) => {
    if (!forecast) return;
    const performance: ModelPerformance = {
      accuracy: Math.max(0, 1 - (forecast.accuracy.mape || 0)),
      precision: Math.max(0, 1 - (forecast.accuracy.rmse || 0)),
      recall: Math.max(0, 1 - (forecast.accuracy.rmse || 0)),
      f1Score: Math.max(0, 1 - (forecast.accuracy.mape + forecast.accuracy.rmse) / 2),
    };
    const driftDetected = performance.f1Score < 0.7;
    scores.push({
      modelName,
      version,
      lastScore: performance,
      driftDetected,
      recommendedAction: driftDetected
        ? 'Trigger retraining via workflow scheduler and tighten validation set.'
        : `Promote ${modelName} to production if not already.`,
    });

    if (driftDetected) {
      void registry.updateRolloutStage(modelName, version, 'development');
    } else if (trend === 'increasing') {
      void registry.updateRolloutStage(modelName, version, 'production');
    }
  };

  addScore('cashflow_arima', portfolio.cashFlow.forecast, portfolio.cashFlow.forecast?.trend);
  addScore('runway_blended', portfolio.runway.forecast, portfolio.runway.forecast?.trend);
  addScore('tax_accrual_curve', portfolio.taxAccruals.forecast, portfolio.taxAccruals.forecast?.trend);

  logger.info('Forecasting model evaluation complete', { tenantId, version, scores });

  return scores;
}
