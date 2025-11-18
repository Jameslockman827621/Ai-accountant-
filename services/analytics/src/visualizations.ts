import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('analytics-service');

// Advanced Visualizations
export interface ChartData {
  labels: string[];
  datasets: Array<{
    label: string;
    data: number[];
    backgroundColor?: string | string[];
  }>;
}

export async function generateRevenueChart(
  tenantId: TenantId,
  months: number = 12
): Promise<ChartData> {
  logger.info('Generating revenue chart', { tenantId, months });

  const result = await db.query<{
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
       AND transaction_date >= NOW() - INTERVAL '${months} months'
     GROUP BY DATE_TRUNC('month', transaction_date)
     ORDER BY month`,
    [tenantId]
  );

  return {
    labels: result.rows.map((r) =>
      new Date(r.month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
    ),
    datasets: [
      {
        label: 'Revenue',
        data: result.rows.map((r) =>
          typeof r.revenue === 'number' ? r.revenue : parseFloat(String(r.revenue || '0'))
        ),
        backgroundColor: 'rgba(34, 197, 94, 0.5)',
      },
    ],
  };
}

export async function generateExpenseBreakdown(tenantId: TenantId): Promise<ChartData> {
  logger.info('Generating expense breakdown', { tenantId });

  const result = await db.query<{
    account_name: string;
    total: string | number;
  }>(
    `SELECT account_name, SUM(amount) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'debit'
       AND (account_code LIKE '5%' OR account_code LIKE '6%')
       AND transaction_date >= NOW() - INTERVAL '12 months'
     GROUP BY account_name
     ORDER BY total DESC
     LIMIT 10`,
    [tenantId]
  );

  const colors = [
    'rgba(239, 68, 68, 0.5)',
    'rgba(249, 115, 22, 0.5)',
    'rgba(234, 179, 8, 0.5)',
    'rgba(34, 197, 94, 0.5)',
    'rgba(59, 130, 246, 0.5)',
  ];

  const fallbackColor = colors[0] ?? 'rgba(107, 114, 128, 0.5)';
  const backgroundColors = result.rows.map((_, i) => colors[i % colors.length] ?? fallbackColor);

  return {
    labels: result.rows.map((r) => r.account_name),
    datasets: [
      {
        label: 'Expenses',
        data: result.rows.map((r) =>
          typeof r.total === 'number' ? r.total : parseFloat(String(r.total || '0'))
        ),
        backgroundColor: backgroundColors,
      },
    ],
  };
}
