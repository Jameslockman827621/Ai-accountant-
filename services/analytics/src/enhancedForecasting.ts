/**
 * Enhanced Forecasting with Machine Learning
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('enhanced-forecasting');

export interface ForecastInput {
  tenantId: string;
  metric: 'revenue' | 'expenses' | 'profit' | 'cash_flow';
  periods: number; // Number of future periods to forecast
  method: 'linear' | 'exponential' | 'seasonal' | 'arima';
  historicalPeriods?: number; // How many past periods to use
}

export interface ForecastResult {
  metric: string;
  periods: Array<{
    period: string;
    forecast: number;
    confidence: number; // 0-1
    lowerBound: number;
    upperBound: number;
  }>;
  accuracy: {
    mape: number; // Mean Absolute Percentage Error
    rmse: number; // Root Mean Square Error
  };
  trend: 'increasing' | 'decreasing' | 'stable';
  seasonality?: {
    detected: boolean;
    period: number;
    strength: number; // 0-1
  };
}

export class EnhancedForecaster {
  async generateForecast(input: ForecastInput): Promise<ForecastResult> {
    // Get historical data
    const historicalData = await this.getHistoricalData(
      input.tenantId,
      input.metric,
      input.historicalPeriods || 12
    );

    if (historicalData.length < 3) {
      throw new Error('Insufficient historical data for forecasting');
    }

    // Detect seasonality
    const seasonality = this.detectSeasonality(historicalData);

    // Generate forecast based on method
    let forecast: ForecastResult['periods'];
    switch (input.method) {
      case 'linear':
        forecast = this.linearForecast(historicalData, input.periods);
        break;
      case 'exponential':
        forecast = this.exponentialForecast(historicalData, input.periods);
        break;
      case 'seasonal':
        forecast = this.seasonalForecast(historicalData, input.periods, seasonality);
        break;
      case 'arima':
        forecast = this.arimaForecast(historicalData, input.periods);
        break;
      default:
        forecast = this.linearForecast(historicalData, input.periods);
    }

    // Calculate accuracy metrics
    const accuracy = this.calculateAccuracy(historicalData, forecast);

    // Determine trend
    const trend = this.determineTrend(historicalData);

    return {
      metric: input.metric,
      periods: forecast,
      accuracy,
      trend,
      seasonality,
    };
  }

  private async getHistoricalData(
    tenantId: string,
    metric: string,
    periods: number
  ): Promise<number[]> {
    const accountType = metric === 'revenue' ? 'revenue' :
                       metric === 'expenses' ? 'expense' :
                       'revenue'; // Default

    const result = await db.query<{ amount: string | number; period: string }>(
      `SELECT 
        DATE_TRUNC('month', transaction_date) as period,
        SUM(amount) as amount
       FROM ledger_entries
       WHERE tenant_id = $1
         AND account_type = $2
       GROUP BY period
       ORDER BY period DESC
       LIMIT $3`,
      [tenantId, accountType, periods]
    );

    return result.rows
      .reverse()
      .map(row => typeof row.amount === 'number'
        ? row.amount
        : parseFloat(String(row.amount || '0')));
  }

  private linearForecast(
    data: number[],
    periods: number
  ): ForecastResult['periods'] {
    const n = data.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = data.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * data[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const forecast: ForecastResult['periods'] = [];
    for (let i = 0; i < periods; i++) {
      const xFuture = n + i;
      const value = slope * xFuture + intercept;
      const stdDev = this.calculateStdDev(data);
      const confidence = Math.max(0, Math.min(1, 1 - (stdDev / Math.abs(value || 1))));

      forecast.push({
        period: `Period ${n + i + 1}`,
        forecast: Math.round(value * 100) / 100,
        confidence,
        lowerBound: Math.round((value - 1.96 * stdDev) * 100) / 100,
        upperBound: Math.round((value + 1.96 * stdDev) * 100) / 100,
      });
    }

    return forecast;
  }

  private exponentialForecast(
    data: number[],
    periods: number
  ): ForecastResult['periods'] {
    // Simple exponential smoothing
    const alpha = 0.3; // Smoothing factor
    let forecastValue = data[0];

    for (let i = 1; i < data.length; i++) {
      forecastValue = alpha * data[i] + (1 - alpha) * forecastValue;
    }

    const forecast: ForecastResult['periods'] = [];
    const stdDev = this.calculateStdDev(data);

    for (let i = 0; i < periods; i++) {
      const confidence = Math.max(0, Math.min(1, 1 - (stdDev / Math.abs(forecastValue || 1))));
      forecast.push({
        period: `Period ${data.length + i + 1}`,
        forecast: Math.round(forecastValue * 100) / 100,
        confidence,
        lowerBound: Math.round((forecastValue - 1.96 * stdDev) * 100) / 100,
        upperBound: Math.round((forecastValue + 1.96 * stdDev) * 100) / 100,
      });
    }

    return forecast;
  }

  private seasonalForecast(
    data: number[],
    periods: number,
    seasonality?: { detected: boolean; period: number; strength: number }
  ): ForecastResult['periods'] {
    if (!seasonality?.detected) {
      return this.linearForecast(data, periods);
    }

    const seasonalPeriod = seasonality.period;
    const forecast: ForecastResult['periods'] = [];
    const stdDev = this.calculateStdDev(data);

    // Calculate seasonal indices
    const seasonalIndices: number[] = [];
    for (let i = 0; i < seasonalPeriod; i++) {
      const seasonalValues: number[] = [];
      for (let j = i; j < data.length; j += seasonalPeriod) {
        seasonalValues.push(data[j]);
      }
      const avg = seasonalValues.reduce((a, b) => a + b, 0) / seasonalValues.length;
      const overallAvg = data.reduce((a, b) => a + b, 0) / data.length;
      seasonalIndices.push(avg / overallAvg);
    }

    // Generate forecast
    const baseTrend = this.calculateTrend(data);
    for (let i = 0; i < periods; i++) {
      const seasonalIndex = seasonalIndices[i % seasonalPeriod];
      const trendValue = baseTrend * (data.length + i);
      const value = trendValue * seasonalIndex;
      const confidence = seasonality.strength;

      forecast.push({
        period: `Period ${data.length + i + 1}`,
        forecast: Math.round(value * 100) / 100,
        confidence,
        lowerBound: Math.round((value - 1.96 * stdDev) * 100) / 100,
        upperBound: Math.round((value + 1.96 * stdDev) * 100) / 100,
      });
    }

    return forecast;
  }

  private arimaForecast(
    data: number[],
    periods: number
  ): ForecastResult['periods'] {
    // Simplified ARIMA - in production use a proper ARIMA library
    // This is a basic implementation
    return this.linearForecast(data, periods);
  }

  private detectSeasonality(data: number[]): {
    detected: boolean;
    period: number;
    strength: number;
  } {
    if (data.length < 6) {
      return { detected: false, period: 0, strength: 0 };
    }

    // Check for monthly seasonality (12 periods)
    if (data.length >= 12) {
      const strength = this.calculateSeasonalStrength(data, 12);
      if (strength > 0.5) {
        return { detected: true, period: 12, strength };
      }
    }

    // Check for quarterly seasonality (4 periods)
    if (data.length >= 4) {
      const strength = this.calculateSeasonalStrength(data, 4);
      if (strength > 0.5) {
        return { detected: true, period: 4, strength };
      }
    }

    return { detected: false, period: 0, strength: 0 };
  }

  private calculateSeasonalStrength(data: number[], period: number): number {
    // Simplified seasonal strength calculation
    const variance = this.calculateVariance(data);
    const seasonalVariance = this.calculateSeasonalVariance(data, period);
    return Math.min(1, seasonalVariance / (variance + 0.001));
  }

  private calculateSeasonalVariance(data: number[], period: number): number {
    const means: number[] = [];
    for (let i = 0; i < period; i++) {
      const values: number[] = [];
      for (let j = i; j < data.length; j += period) {
        values.push(data[j]);
      }
      means.push(values.reduce((a, b) => a + b, 0) / values.length);
    }
    const overallMean = means.reduce((a, b) => a + b, 0) / means.length;
    return means.reduce((sum, m) => sum + Math.pow(m - overallMean, 2), 0) / means.length;
  }

  private calculateTrend(data: number[]): number {
    const n = data.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = data.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * data[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  private calculateStdDev(data: number[]): number {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    return Math.sqrt(variance);
  }

  private calculateVariance(data: number[]): number {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    return data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
  }

  private calculateAccuracy(
    historical: number[],
    forecast: ForecastResult['periods']
  ): { mape: number; rmse: number } {
    // Use last few historical values for validation
    const validationSize = Math.min(3, Math.floor(historical.length * 0.2));
    const validationData = historical.slice(-validationSize);
    const forecastValues = forecast.slice(0, validationSize).map(f => f.forecast);

    // Calculate MAPE
    let mape = 0;
    for (let i = 0; i < validationData.length; i++) {
      if (validationData[i] !== 0) {
        mape += Math.abs((validationData[i] - forecastValues[i]) / validationData[i]);
      }
    }
    mape = (mape / validationData.length) * 100;

    // Calculate RMSE
    let rmse = 0;
    for (let i = 0; i < validationData.length; i++) {
      rmse += Math.pow(validationData[i] - forecastValues[i], 2);
    }
    rmse = Math.sqrt(rmse / validationData.length);

    return { mape, rmse };
  }

  private determineTrend(data: number[]): 'increasing' | 'decreasing' | 'stable' {
    if (data.length < 2) return 'stable';

    const firstHalf = data.slice(0, Math.floor(data.length / 2));
    const secondHalf = data.slice(Math.floor(data.length / 2));

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const change = ((secondAvg - firstAvg) / Math.abs(firstAvg || 1)) * 100;

    if (change > 5) return 'increasing';
    if (change < -5) return 'decreasing';
    return 'stable';
  }
}

export const enhancedForecaster = new EnhancedForecaster();
