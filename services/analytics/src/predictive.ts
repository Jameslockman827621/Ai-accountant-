import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('analytics-service');

export interface Prediction {
  type: 'revenue' | 'expense' | 'cashflow' | 'tax';
  period: { start: Date; end: Date };
  predictedValue: number;
  confidence: number;
  factors: Array<{ name: string; impact: number }>;
}

export async function predictRevenue(
  tenantId: TenantId,
  months: number = 6
): Promise<Prediction> {
  logger.info('Predicting revenue', { tenantId, months });

  // Get historical revenue
  const historical = await db.query<{
    month: Date;
    revenue: string | number;
  }>(
    `SELECT 
       DATE_TRUNC('month', transaction_date) as month,
       SUM(amount) as revenue
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'credit'
       AND account_code LIKE '4%'
       AND transaction_date >= NOW() - INTERVAL '12 months'
     GROUP BY DATE_TRUNC('month', transaction_date)
     ORDER BY month`,
    [tenantId]
  );

  // Simple linear regression for prediction
  const revenues = historical.rows.map(r =>
    typeof r.revenue === 'number' ? r.revenue : parseFloat(String(r.revenue || '0'))
  );

  const revenueSamples = revenues.length > 0 ? revenues : [0];
  const avgRevenue = revenueSamples.reduce((a, b) => a + b, 0) / revenueSamples.length;
  const firstRevenue = revenueSamples[0] ?? 0;
  const lastRevenue = revenueSamples[revenueSamples.length - 1] ?? firstRevenue;
  const trend =
    revenueSamples.length > 1 ? (lastRevenue - firstRevenue) / revenueSamples.length : 0;

  const predictedValue = avgRevenue + trend * months;
  const confidence = revenues.length >= 6 ? 0.85 : 0.65;

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + months);

  return {
    type: 'revenue',
    period: {
      start: periodStart,
      end: periodEnd,
    },
    predictedValue: Math.round(predictedValue * 100) / 100,
    confidence,
    factors: [
      { name: 'Historical Average', impact: 0.7 },
      { name: 'Trend', impact: 0.3 },
    ],
  };
}

export async function detectAnomalies(
  tenantId: TenantId
): Promise<Array<{
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  recommendation: string;
}>> {
  logger.info('Detecting anomalies', { tenantId });

  const anomalies: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high';
    description: string;
    recommendation: string;
  }> = [];

  // Check for unusual spending patterns
  const spending = await db.query<{ amount: string | number }>(
    `SELECT SUM(amount) as amount
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'debit'
       AND transaction_date >= NOW() - INTERVAL '30 days'`,
    [tenantId]
  );

  const currentSpending = typeof spending.rows[0]?.amount === 'number'
    ? spending.rows[0].amount
    : parseFloat(String(spending.rows[0]?.amount || '0'));

  // Compare with previous month
  const previousSpending = await db.query<{ amount: string | number }>(
    `SELECT SUM(amount) as amount
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'debit'
       AND transaction_date >= NOW() - INTERVAL '60 days'
       AND transaction_date < NOW() - INTERVAL '30 days'`,
    [tenantId]
  );

  const prevSpending = typeof previousSpending.rows[0]?.amount === 'number'
    ? previousSpending.rows[0].amount
    : parseFloat(String(previousSpending.rows[0]?.amount || '0'));

  if (prevSpending > 0 && currentSpending > prevSpending * 1.5) {
    anomalies.push({
      type: 'spending_increase',
      severity: 'high',
      description: `Spending increased by ${((currentSpending / prevSpending - 1) * 100).toFixed(0)}% compared to last month`,
      recommendation: 'Review recent expenses and verify all transactions are legitimate',
    });
  }

  return anomalies;
}
