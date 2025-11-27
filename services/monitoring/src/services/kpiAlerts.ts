import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { AlertingService } from './alertingService';
import { notificationManager } from '@ai-accountant/notification-service/services/notificationManager';

const logger = createLogger('kpi-alerts');
const alerting = new AlertingService();

export interface KPIReport {
  revenueGrowthPct: number;
  burnRate: number;
  runwayMonths: number;
  taxAccrualChangePct: number;
  anomalies: string[];
}

export async function publishFinancialKpis(tenantId: TenantId): Promise<KPIReport> {
  const [revenue, expenses, accruals] = await Promise.all([
    db.query<{ total: string | number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM ledger_entries
       WHERE tenant_id = $1 AND entry_type = 'credit'
         AND transaction_date >= NOW() - INTERVAL '60 days'`,
      [tenantId]
    ),
    db.query<{ total: string | number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM ledger_entries
       WHERE tenant_id = $1 AND entry_type = 'debit'
         AND transaction_date >= NOW() - INTERVAL '60 days'`,
      [tenantId]
    ),
    db.query<{ total: string | number }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM ledger_entries
       WHERE tenant_id = $1 AND account_code LIKE '2%'
         AND transaction_date >= NOW() - INTERVAL '90 days'`,
      [tenantId]
    ),
  ]);

  const revenueValue = parseFloat(String(revenue.rows[0]?.total || 0));
  const expenseValue = parseFloat(String(expenses.rows[0]?.total || 0));
  const burnRate = Math.max(0, expenseValue - revenueValue) / 2;
  const runwayMonths = burnRate > 0 ? Math.max(1, Math.round((revenueValue - expenseValue) / burnRate)) : 12;
  const taxAccrualChangePct = revenueValue > 0 ? Math.round(((accruals.rows[0]?.total as number) / revenueValue) * 100) : 0;

  const anomalies: string[] = [];
  if (burnRate > revenueValue * 0.6) {
    anomalies.push('Burn rate exceeds 60% of revenue in the last 60 days.');
  }
  if (taxAccrualChangePct > 25) {
    anomalies.push('Tax accruals spiked beyond 25% of revenue; validate filings.');
  }

  await Promise.all([
    alerting.evaluateAlerts('analytics-service', 'burn_rate', burnRate),
    alerting.evaluateAlerts('analytics-service', 'tax_accruals', taxAccrualChangePct),
  ]);

  if (anomalies.length > 0) {
    await notificationManager.createNotification(
      tenantId,
      null,
      'warning',
      'Financial anomalies detected',
      anomalies.join(' '),
      { label: 'View alerts', url: '/alerts' },
      { burnRate, taxAccrualChangePct }
    );
  }

  await notificationManager.createNotification(
    tenantId,
    null,
    'info',
    'Latest KPI snapshot ready',
    `Revenue growth ${(revenueValue || 0).toFixed(0)} | Burn £${burnRate.toFixed(0)} | Runway ${runwayMonths} months`,
    { label: 'Open dashboard', url: '/forecasting' },
    { revenue: revenueValue, burnRate, runwayMonths }
  );

  logger.info('Published KPI report', { tenantId, burnRate, runwayMonths, taxAccrualChangePct });

  return { revenueGrowthPct: 0, burnRate, runwayMonths, taxAccrualChangePct, anomalies };
}
