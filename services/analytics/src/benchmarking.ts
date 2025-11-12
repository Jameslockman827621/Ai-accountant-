import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('analytics-service');

// Industry Benchmarking
export async function compareToIndustry(
  tenantId: TenantId,
  industry: string
): Promise<{
  metric: string;
  tenantValue: number;
  industryAverage: number;
  percentile: number;
}> {
  logger.info('Comparing to industry benchmarks', { tenantId, industry });

  // Get tenant metrics
  const revenue = await db.query<{ total: string | number }>(
    `SELECT SUM(amount) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'credit'
       AND account_code LIKE '4%'
       AND transaction_date >= NOW() - INTERVAL '12 months'`,
    [tenantId]
  );

  const tenantRevenue = typeof revenue.rows[0]?.total === 'number'
    ? revenue.rows[0].total
    : parseFloat(String(revenue.rows[0]?.total || '0'));

  // Industry averages (in production, use actual industry data)
  const industryAverages: Record<string, number> = {
    'technology': 500000,
    'retail': 300000,
    'services': 200000,
  };

  const industryAvg = industryAverages[industry] || 250000;
  const percentile = (tenantRevenue / industryAvg) * 50; // Simplified calculation

  return {
    metric: 'Annual Revenue',
    tenantValue: tenantRevenue,
    industryAverage: industryAvg,
    percentile: Math.min(100, Math.max(0, percentile)),
  };
}
