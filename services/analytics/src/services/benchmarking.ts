/**
 * Industry Benchmarking Service
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';

const logger = createLogger('benchmarking');

export interface BenchmarkData {
  industry: string;
  metric: string;
  period: string;
  value: number;
  percentile25: number;
  percentile50: number;
  percentile75: number;
  percentile90: number;
  source: string;
  updatedAt: Date;
}

export interface BenchmarkComparison {
  metric: string;
  userValue: number;
  industryAverage: number;
  percentile: number;
  performance: 'above_average' | 'average' | 'below_average';
  recommendation?: string;
}

export class BenchmarkingService {
  // Default benchmark data (in production, fetch from external APIs)
  private defaultBenchmarks: BenchmarkData[] = [
    {
      industry: 'professional_services',
      metric: 'gross_margin',
      period: '2024',
      value: 0.65,
      percentile25: 0.55,
      percentile50: 0.65,
      percentile75: 0.75,
      percentile90: 0.85,
      source: 'industry_average',
      updatedAt: new Date(),
    },
    {
      industry: 'retail',
      metric: 'gross_margin',
      period: '2024',
      value: 0.35,
      percentile25: 0.25,
      percentile50: 0.35,
      percentile75: 0.45,
      percentile90: 0.55,
      source: 'industry_average',
      updatedAt: new Date(),
    },
    {
      industry: 'professional_services',
      metric: 'net_profit_margin',
      period: '2024',
      value: 0.20,
      percentile25: 0.15,
      percentile50: 0.20,
      percentile75: 0.25,
      percentile90: 0.35,
      source: 'industry_average',
      updatedAt: new Date(),
    },
    {
      industry: 'retail',
      metric: 'net_profit_margin',
      period: '2024',
      value: 0.05,
      percentile25: 0.02,
      percentile50: 0.05,
      percentile75: 0.08,
      percentile90: 0.12,
      source: 'industry_average',
      updatedAt: new Date(),
    },
  ];

  async getBenchmark(
    industry: string,
    metric: string,
    period: string = '2024'
  ): Promise<BenchmarkData | null> {
    // Try database first
    const result = await db.query<BenchmarkData>(
      `SELECT * FROM benchmark_data
       WHERE industry = $1 AND metric = $2 AND period = $3
       ORDER BY updated_at DESC LIMIT 1`,
      [industry, metric, period]
    ).catch(() => ({ rows: [] }));

    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // Fallback to default benchmarks
    const defaultBenchmark = this.defaultBenchmarks.find(
      b => b.industry === industry && b.metric === metric && b.period === period
    );

    return defaultBenchmark || null;
  }

  async compareToBenchmark(
    tenantId: string,
    industry: string,
    metrics: string[],
    period: string = '2024'
  ): Promise<BenchmarkComparison[]> {
    const comparisons: BenchmarkComparison[] = [];

    for (const metric of metrics) {
      const benchmark = await this.getBenchmark(industry, metric, period);
      if (!benchmark) {
        continue;
      }

      // Get user's metric value
      const userValue = await this.getUserMetric(tenantId, metric, period);
      if (userValue === null) {
        continue;
      }

      // Calculate percentile
      let percentile = 50;
      if (userValue >= benchmark.percentile90) {
        percentile = 90;
      } else if (userValue >= benchmark.percentile75) {
        percentile = 75;
      } else if (userValue >= benchmark.percentile50) {
        percentile = 50;
      } else if (userValue >= benchmark.percentile25) {
        percentile = 25;
      } else {
        percentile = 10;
      }

      // Determine performance
      let performance: 'above_average' | 'average' | 'below_average';
      if (userValue >= benchmark.percentile75) {
        performance = 'above_average';
      } else if (userValue >= benchmark.percentile25) {
        performance = 'average';
      } else {
        performance = 'below_average';
      }

      // Generate recommendation
      let recommendation: string | undefined;
      if (performance === 'below_average') {
        recommendation = this.generateRecommendation(metric, userValue, benchmark.value);
      }

      comparisons.push({
        metric,
        userValue,
        industryAverage: benchmark.value,
        percentile,
        performance,
        recommendation,
      });
    }

    return comparisons;
  }

  private async getUserMetric(
    tenantId: string,
    metric: string,
    period: string
  ): Promise<number | null> {
    const [year, quarter] = period.split('-Q');
    const startDate = quarter
      ? new Date(parseInt(year), (parseInt(quarter) - 1) * 3, 1)
      : new Date(parseInt(year), 0, 1);
    const endDate = quarter
      ? new Date(parseInt(year), parseInt(quarter) * 3, 0)
      : new Date(parseInt(year), 11, 31);

    switch (metric) {
      case 'gross_margin': {
        const revenue = await db.query<{ total: string | number }>(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM ledger_entries
           WHERE tenant_id = $1 AND account_type = 'revenue'
             AND transaction_date BETWEEN $2 AND $3`,
          [tenantId, startDate, endDate]
        );
        const cogs = await db.query<{ total: string | number }>(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM ledger_entries
           WHERE tenant_id = $1 AND account_type = 'expense'
             AND account_code LIKE '5%'
             AND transaction_date BETWEEN $2 AND $3`,
          [tenantId, startDate, endDate]
        );

        const rev = typeof revenue.rows[0]?.total === 'number'
          ? revenue.rows[0].total
          : parseFloat(String(revenue.rows[0]?.total || '0'));
        const cost = typeof cogs.rows[0]?.total === 'number'
          ? cogs.rows[0].total
          : parseFloat(String(cogs.rows[0]?.total || '0'));

        return rev > 0 ? (rev - cost) / rev : null;
      }

      case 'net_profit_margin': {
        const revenue = await db.query<{ total: string | number }>(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM ledger_entries
           WHERE tenant_id = $1 AND account_type = 'revenue'
             AND transaction_date BETWEEN $2 AND $3`,
          [tenantId, startDate, endDate]
        );
        const expenses = await db.query<{ total: string | number }>(
          `SELECT COALESCE(SUM(amount), 0) as total
           FROM ledger_entries
           WHERE tenant_id = $1 AND account_type = 'expense'
             AND transaction_date BETWEEN $2 AND $3`,
          [tenantId, startDate, endDate]
        );

        const rev = typeof revenue.rows[0]?.total === 'number'
          ? revenue.rows[0].total
          : parseFloat(String(revenue.rows[0]?.total || '0'));
        const exp = typeof expenses.rows[0]?.total === 'number'
          ? expenses.rows[0].total
          : parseFloat(String(expenses.rows[0]?.total || '0'));

        return rev > 0 ? (rev - exp) / rev : null;
      }

      default:
        return null;
    }
  }

  private generateRecommendation(metric: string, userValue: number, benchmark: number): string {
    const difference = ((benchmark - userValue) / benchmark) * 100;

    switch (metric) {
      case 'gross_margin':
        return `Your gross margin is ${difference.toFixed(1)}% below industry average. Consider reviewing pricing strategy or cost management.`;
      case 'net_profit_margin':
        return `Your net profit margin is ${difference.toFixed(1)}% below industry average. Review operating expenses and revenue optimization opportunities.`;
      default:
        return `Your ${metric} is below industry average. Consider reviewing your business operations.`;
    }
  }

  async updateBenchmarkData(benchmark: BenchmarkData): Promise<void> {
    await db.query(
      `INSERT INTO benchmark_data (
        industry, metric, period, value, percentile_25, percentile_50, percentile_75,
        percentile_90, source, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (industry, metric, period) DO UPDATE
      SET value = $4, percentile_25 = $5, percentile_50 = $6, percentile_75 = $7,
          percentile_90 = $8, source = $9, updated_at = NOW()`,
      [
        benchmark.industry,
        benchmark.metric,
        benchmark.period,
        benchmark.value,
        benchmark.percentile25,
        benchmark.percentile50,
        benchmark.percentile75,
        benchmark.percentile90,
        benchmark.source,
      ]
    );
  }
}

export const benchmarkingService = new BenchmarkingService();
