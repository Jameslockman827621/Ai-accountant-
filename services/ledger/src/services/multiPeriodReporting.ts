/**
 * Multi-Period Reporting
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('multi-period-reporting');

export interface Period {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  type: 'monthly' | 'quarterly' | 'yearly' | 'custom';
}

export interface MultiPeriodReport {
  periods: Period[];
  metrics: {
    revenue: number[];
    expenses: number[];
    profit: number[];
    growth: number[];
  };
  comparisons: {
    periodOverPeriod: Record<string, number>;
    yearOverYear: Record<string, number>;
    averages: Record<string, number>;
  };
}

export class MultiPeriodReporter {
  async generateReport(
    tenantId: string,
    periods: Period[],
    metrics: string[] = ['revenue', 'expenses', 'profit']
  ): Promise<MultiPeriodReport> {
    const report: MultiPeriodReport = {
      periods,
      metrics: {
        revenue: [],
        expenses: [],
        profit: [],
        growth: [],
      },
      comparisons: {
        periodOverPeriod: {},
        yearOverYear: {},
        averages: {},
      },
    };

    // Calculate metrics for each period
    for (const period of periods) {
      const periodMetrics = await this.getPeriodMetrics(tenantId, period, metrics);
      
      report.metrics.revenue.push(periodMetrics.revenue || 0);
      report.metrics.expenses.push(periodMetrics.expenses || 0);
      report.metrics.profit.push(periodMetrics.profit || 0);
    }

    // Calculate growth rates
    for (let i = 1; i < report.metrics.revenue.length; i++) {
      const prevRevenue = report.metrics.revenue[i - 1];
      const currRevenue = report.metrics.revenue[i];
      const growth = prevRevenue > 0 ? ((currRevenue - prevRevenue) / prevRevenue) * 100 : 0;
      report.metrics.growth.push(growth);
    }

    // Calculate comparisons
    report.comparisons = this.calculateComparisons(report);

    return report;
  }

  private async getPeriodMetrics(
    tenantId: string,
    period: Period,
    metrics: string[]
  ): Promise<Record<string, number>> {
    const result: Record<string, number> = {};

    if (metrics.includes('revenue')) {
      const revenue = await db.query<{ total: string | number }>(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM ledger_entries
         WHERE tenant_id = $1
           AND account_type = 'revenue'
           AND transaction_date BETWEEN $2 AND $3`,
        [tenantId, period.startDate, period.endDate]
      );
      result.revenue = typeof revenue.rows[0]?.total === 'number'
        ? revenue.rows[0].total
        : parseFloat(String(revenue.rows[0]?.total || '0'));
    }

    if (metrics.includes('expenses')) {
      const expenses = await db.query<{ total: string | number }>(
        `SELECT COALESCE(SUM(amount), 0) as total
         FROM ledger_entries
         WHERE tenant_id = $1
           AND account_type = 'expense'
           AND transaction_date BETWEEN $2 AND $3`,
        [tenantId, period.startDate, period.endDate]
      );
      result.expenses = typeof expenses.rows[0]?.total === 'number'
        ? expenses.rows[0].total
        : parseFloat(String(expenses.rows[0]?.total || '0'));
    }

    result.profit = (result.revenue || 0) - (result.expenses || 0);

    return result;
  }

  private calculateComparisons(report: MultiPeriodReport): MultiPeriodReport['comparisons'] {
    const comparisons: MultiPeriodReport['comparisons'] = {
      periodOverPeriod: {},
      yearOverYear: {},
      averages: {},
    };

    // Period-over-period growth
    for (let i = 1; i < report.metrics.revenue.length; i++) {
      const key = `${report.periods[i - 1].name} → ${report.periods[i].name}`;
      const prevProfit = report.metrics.profit[i - 1];
      const currProfit = report.metrics.profit[i];
      comparisons.periodOverPeriod[key] = prevProfit > 0
        ? ((currProfit - prevProfit) / prevProfit) * 100
        : 0;
    }

    // Year-over-year (if we have yearly data)
    const yearlyPeriods = report.periods.filter(p => p.type === 'yearly');
    if (yearlyPeriods.length >= 2) {
      for (let i = 1; i < yearlyPeriods.length; i++) {
        const prevYearIndex = report.periods.indexOf(yearlyPeriods[i - 1]);
        const currYearIndex = report.periods.indexOf(yearlyPeriods[i]);
        const key = `${yearlyPeriods[i - 1].name} → ${yearlyPeriods[i].name}`;
        const prevRevenue = report.metrics.revenue[prevYearIndex];
        const currRevenue = report.metrics.revenue[currYearIndex];
        comparisons.yearOverYear[key] = prevRevenue > 0
          ? ((currRevenue - prevRevenue) / prevRevenue) * 100
          : 0;
      }
    }

    // Averages
    comparisons.averages.revenue = report.metrics.revenue.reduce((a, b) => a + b, 0) / report.metrics.revenue.length;
    comparisons.averages.expenses = report.metrics.expenses.reduce((a, b) => a + b, 0) / report.metrics.expenses.length;
    comparisons.averages.profit = report.metrics.profit.reduce((a, b) => a + b, 0) / report.metrics.profit.length;
    comparisons.averages.growth = report.metrics.growth.length > 0
      ? report.metrics.growth.reduce((a, b) => a + b, 0) / report.metrics.growth.length
      : 0;

    return comparisons;
  }

  async generateTrendAnalysis(
    tenantId: string,
    periods: Period[]
  ): Promise<{
    trend: 'increasing' | 'decreasing' | 'stable';
    slope: number;
    forecast: number[];
  }> {
    const report = await this.generateReport(tenantId, periods);
    const profits = report.metrics.profit;

    // Calculate linear regression slope
    const n = profits.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = profits.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * profits[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Determine trend
    let trend: 'increasing' | 'decreasing' | 'stable';
    if (slope > 0.1) {
      trend = 'increasing';
    } else if (slope < -0.1) {
      trend = 'decreasing';
    } else {
      trend = 'stable';
    }

    // Forecast next 3 periods
    const forecast: number[] = [];
    for (let i = 0; i < 3; i++) {
      const xFuture = n + i;
      forecast.push(slope * xFuture + intercept);
    }

    return { trend, slope, forecast };
  }
}

export const multiPeriodReporter = new MultiPeriodReporter();
