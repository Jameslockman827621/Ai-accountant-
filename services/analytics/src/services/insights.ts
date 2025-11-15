import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getBaselineMetrics } from './scenarioPlanner';

const logger = createLogger('analytics-service');

export type InsightSeverity = 'info' | 'warning' | 'critical';

export interface Insight {
  id: string;
  title: string;
  message: string;
  severity: InsightSeverity;
  metric?: string;
  action?: string;
  cta?: string;
}

export async function getExecutiveInsights(tenantId: TenantId): Promise<Insight[]> {
  logger.info('Generating executive insights', { tenantId });
  const insights: Insight[] = [];

  const baseline = await getBaselineMetrics(tenantId);
  if (Number.isFinite(baseline.runwayMonths) && baseline.runwayMonths < 6) {
    insights.push({
      id: 'low-runway',
      title: 'Cash runway under 6 months',
      message: `Current runway is ${baseline.runwayMonths.toFixed(1)} months with burn of £${baseline.monthlyBurn.toLocaleString('en-GB')}/mo.`,
      severity: baseline.runwayMonths < 3 ? 'critical' : 'warning',
      metric: 'runwayMonths',
      action: 'Review hiring plans or accelerate collections to extend runway.',
      cta: 'Use the scenario planner to evaluate cuts or injections.',
    });
  }

  const revenueTrend = await getRevenueTrend(tenantId);
  if (revenueTrend?.pctChange !== undefined) {
    const pct = revenueTrend.pctChange;
    if (pct <= -10) {
      insights.push({
        id: 'revenue-decline',
        title: 'Revenue trending down',
        message: `Last 30 days revenue (£${revenueTrend.current.toLocaleString('en-GB')}) is ${Math.abs(pct).toFixed(1)}% lower than the prior 30 days.`,
        severity: pct <= -20 ? 'critical' : 'warning',
        metric: 'monthlyRevenue',
        action: 'Investigate lost customers or delayed invoicing.',
      });
    } else if (pct >= 10) {
      insights.push({
        id: 'revenue-growth',
        title: 'Revenue accelerating',
        message: `Revenue increased ${pct.toFixed(1)}% over the last 30 days.`,
        severity: 'info',
        metric: 'monthlyRevenue',
        action: 'Ensure delivery capacity keeps pace with growth.',
      });
    }
  }

  const overdueFilings = await countOverdueFilings(tenantId);
  if (overdueFilings > 0) {
    insights.push({
      id: 'overdue-filings',
      title: 'Filings overdue',
      message: `${overdueFilings} filing(s) are past their due date.`,
      severity: 'critical',
      metric: 'filings',
      action: 'Prioritise review and submission to avoid penalties.',
      cta: 'Open the filings panel to approve and submit.',
    });
  }

  const pendingTasks = await countPendingTasks(tenantId);
  if (pendingTasks > 20) {
    insights.push({
      id: 'review-backlog',
      title: 'Review backlog growing',
      message: `${pendingTasks} documents or tasks waiting for review.`,
      severity: 'warning',
      metric: 'pendingTasks',
      action: 'Allocate reviewer capacity or enable automation playbooks.',
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: 'steady',
      title: 'All systems nominal',
      message: 'No critical risks detected in the last 30 days.',
      severity: 'info',
      action: 'Continue monitoring key metrics.',
    });
  }

  return insights;
}

async function getRevenueTrend(
  tenantId: TenantId
): Promise<{ current: number; previous: number; pctChange: number } | null> {
  const result = await db.query<{
    bucket: number;
    total: string | number | null;
  }>(
    `SELECT bucket, COALESCE(SUM(amount), 0) AS total
     FROM (
       SELECT
         CASE
           WHEN transaction_date >= NOW() - INTERVAL '30 days' THEN 1
           WHEN transaction_date >= NOW() - INTERVAL '60 days' THEN 0
           ELSE -1
         END AS bucket,
         amount
       FROM ledger_entries
       WHERE tenant_id = $1
         AND entry_type = 'credit'
         AND account_code LIKE '4%'
         AND transaction_date >= NOW() - INTERVAL '60 days'
     ) t
     WHERE bucket >= 0
     GROUP BY bucket`,
    [tenantId]
  );

  const data = new Map<number, number>();
  for (const row of result.rows) {
    data.set(row.bucket, parseDbNumber(row.total));
  }
  if (!data.has(1) || !data.has(0)) {
    return null;
  }
  const current = data.get(1)!;
  const previous = data.get(0)!;
  const pctChange = previous === 0 ? 0 : ((current - previous) / previous) * 100;
  return { current, previous, pctChange };
}

async function countOverdueFilings(tenantId: TenantId): Promise<number> {
  const res = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) AS count
     FROM filings
     WHERE tenant_id = $1
       AND status IN ('draft', 'pending_approval')
       AND period_end < NOW() - INTERVAL '1 day'`,
    [tenantId]
  );
  return parseInt(String(res.rows[0]?.count ?? '0'), 10);
}

async function countPendingTasks(tenantId: TenantId): Promise<number> {
  const res = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) AS count
     FROM review_tasks
     WHERE tenant_id = $1
       AND status = 'pending'`,
    [tenantId]
  );
  return parseInt(String(res.rows[0]?.count ?? '0'), 10);
}

function parseDbNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
