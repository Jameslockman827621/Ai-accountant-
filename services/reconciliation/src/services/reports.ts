import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import { getReconciliationSummary, ReconciliationSummary } from './summary';

export interface VarianceBreakdown {
  period: string;
  bankTotal: number;
  ledgerTotal: number;
  variance: number;
  variancePercentage: number;
  unreconciledTransactions: number;
}

export interface ExceptionHotspot {
  category: string;
  open: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ReconciliationReport {
  generatedAt: string;
  rangeDays: number;
  summary: ReconciliationSummary;
  variances: VarianceBreakdown[];
  hotspots: ExceptionHotspot[];
}

export async function generateReconciliationReport(
  tenantId: TenantId,
  days: number = 30
): Promise<ReconciliationReport> {
  const rangeDays = Math.max(7, Math.min(days, 180));
  const summary = await getReconciliationSummary(tenantId);
  const variances = await calculateVariances(tenantId, rangeDays);
  const hotspots = await getExceptionHotspots(tenantId);

  return {
    generatedAt: new Date().toISOString(),
    rangeDays,
    summary,
    variances,
    hotspots,
  };
}

async function calculateVariances(tenantId: TenantId, days: number): Promise<VarianceBreakdown[]> {
  const result = await db.query<{
    day: Date;
    bank_total: string | number | null;
    ledger_total: string | number | null;
    unreconciled: string | number | null;
  }>(
    `WITH series AS (
      SELECT generate_series(
        (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day')::date,
        CURRENT_DATE,
        INTERVAL '1 day'
      ) AS day
    ),
    bank_activity AS (
      SELECT date::date AS day, SUM(amount) AS bank_total, COUNT(*) FILTER (WHERE reconciled = false) AS unreconciled
      FROM bank_transactions
      WHERE tenant_id = $1
        AND date >= (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day')
      GROUP BY date::date
    ),
    ledger_activity AS (
      SELECT transaction_date::date AS day, SUM(amount) AS ledger_total
      FROM ledger_entries
      WHERE tenant_id = $1
        AND transaction_date >= (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day')
      GROUP BY transaction_date::date
    )
    SELECT s.day,
           COALESCE(b.bank_total, 0) AS bank_total,
           COALESCE(l.ledger_total, 0) AS ledger_total,
           COALESCE(b.unreconciled, 0) AS unreconciled
    FROM series s
    LEFT JOIN bank_activity b ON b.day = s.day
    LEFT JOIN ledger_activity l ON l.day = s.day
    ORDER BY s.day`,
    [tenantId, days]
  );

  return result.rows.map((row) => {
    const bankTotal = Number(row.bank_total || 0);
    const ledgerTotal = Number(row.ledger_total || 0);
    const variance = bankTotal - ledgerTotal;
    return {
      period: row.day.toISOString().slice(0, 10),
      bankTotal: Math.round(bankTotal * 100) / 100,
      ledgerTotal: Math.round(ledgerTotal * 100) / 100,
      variance: Math.round(variance * 100) / 100,
      variancePercentage: ledgerTotal !== 0 ? Number(((variance / ledgerTotal) * 100).toFixed(2)) : 0,
      unreconciledTransactions: Number(row.unreconciled || 0),
    };
  });
}

async function getExceptionHotspots(tenantId: TenantId): Promise<ExceptionHotspot[]> {
  const result = await db.query<{
    exception_type: string;
    severity: string;
    count: string | number;
  }>(
    `SELECT exception_type, severity, COUNT(*) AS count
     FROM reconciliation_exceptions
     WHERE tenant_id = $1 AND status <> 'resolved'
     GROUP BY exception_type, severity
     ORDER BY COUNT(*) DESC
     LIMIT 10`,
    [tenantId]
  );

  return result.rows.map((row) => ({
    category: row.exception_type,
    severity: (row.severity as ExceptionHotspot['severity']) || 'low',
    open: Number(row.count || 0),
  }));
}
