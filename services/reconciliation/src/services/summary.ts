import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

export interface ReconciliationSummary {
  totalTransactions: number;
  reconciledTransactions: number;
  pendingTransactions: number;
  pendingAmount: number;
  autoMatchRate: number;
  ledgerPendingEntries: number;
  lastReconciledAt: string | null;
  openExceptions: number;
  criticalExceptions: number;
  avgTimeToReconcileHours: number | null;
}

export interface ReconciliationTrendPoint {
  date: string;
  totalTransactions: number;
  reconciledTransactions: number;
  pendingTransactions: number;
  openExceptions: number;
}

export async function getReconciliationSummary(tenantId: TenantId): Promise<ReconciliationSummary> {
  const summaryResult = await db.query<{
    total_transactions: string;
    reconciled_transactions: string;
    pending_transactions: string;
    pending_amount: string | null;
    last_reconciled_at: Date | null;
    avg_reconcile_seconds: string | null;
  }>(
    `SELECT
        COUNT(*)::int AS total_transactions,
        COUNT(*) FILTER (WHERE reconciled)::int AS reconciled_transactions,
        COUNT(*) FILTER (WHERE NOT reconciled)::int AS pending_transactions,
        COALESCE(SUM(CASE WHEN NOT reconciled THEN amount ELSE 0 END), 0)::numeric AS pending_amount,
        MAX(CASE WHEN reconciled THEN updated_at ELSE NULL END) AS last_reconciled_at,
        AVG(EXTRACT(EPOCH FROM (updated_at - date))) FILTER (WHERE reconciled AND updated_at IS NOT NULL)::numeric AS avg_reconcile_seconds
     FROM bank_transactions
     WHERE tenant_id = $1`,
    [tenantId]
  );

  const ledgerResult = await db.query<{ pending_ledger: string }>(
    `SELECT COUNT(*) FILTER (WHERE reconciled = false)::int AS pending_ledger
       FROM ledger_entries
      WHERE tenant_id = $1`,
    [tenantId]
  );

  const exceptionsResult = await db.query<{
    open_exceptions: string;
    critical_exceptions: string;
  }>(
    `SELECT
        COUNT(*) FILTER (WHERE status <> 'resolved')::int AS open_exceptions,
        COUNT(*) FILTER (WHERE status <> 'resolved' AND severity = 'critical')::int AS critical_exceptions
       FROM reconciliation_exceptions
      WHERE tenant_id = $1`,
    [tenantId]
  );

  const summaryRow = summaryResult.rows[0];
  const ledgerRow = ledgerResult.rows[0];
  const exceptionRow = exceptionsResult.rows[0];

  const totalTransactions = Number(summaryRow?.total_transactions || 0);
  const reconciledTransactions = Number(summaryRow?.reconciled_transactions || 0);
  const pendingTransactions = Number(summaryRow?.pending_transactions || 0);

  return {
    totalTransactions,
    reconciledTransactions,
    pendingTransactions,
    pendingAmount: Number(summaryRow?.pending_amount || 0),
    autoMatchRate: totalTransactions > 0 ? Number((reconciledTransactions / totalTransactions).toFixed(4)) : 0,
    ledgerPendingEntries: Number(ledgerRow?.pending_ledger || 0),
    lastReconciledAt: summaryRow?.last_reconciled_at
      ? summaryRow.last_reconciled_at.toISOString()
      : null,
    openExceptions: Number(exceptionRow?.open_exceptions || 0),
    criticalExceptions: Number(exceptionRow?.critical_exceptions || 0),
    avgTimeToReconcileHours: summaryRow?.avg_reconcile_seconds
      ? Number((Number(summaryRow.avg_reconcile_seconds) / 3600).toFixed(2))
      : null,
  };
}

export async function getReconciliationTrends(
  tenantId: TenantId,
  days: number = 30
): Promise<ReconciliationTrendPoint[]> {
  const trendResult = await db.query<{
    day: Date;
    total_transactions: string | null;
    reconciled_transactions: string | null;
    pending_transactions: string | null;
    open_exceptions: string | null;
  }>(
    `
    WITH series AS (
      SELECT generate_series(
        (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day')::date,
        CURRENT_DATE,
        INTERVAL '1 day'
      ) AS day
    ),
    bank_activity AS (
      SELECT
        date::date AS day,
        COUNT(*)::int AS total_transactions,
        COUNT(*) FILTER (WHERE reconciled)::int AS reconciled_transactions,
        COUNT(*) FILTER (WHERE NOT reconciled)::int AS pending_transactions
      FROM bank_transactions
      WHERE tenant_id = $1
        AND date >= (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day')
      GROUP BY date::date
    ),
    exception_activity AS (
      SELECT
        created_at::date AS day,
        COUNT(*) FILTER (WHERE status <> 'resolved')::int AS open_exceptions
      FROM reconciliation_exceptions
      WHERE tenant_id = $1
        AND created_at >= (CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day')
      GROUP BY created_at::date
    )
    SELECT
      s.day,
      COALESCE(b.total_transactions, 0) AS total_transactions,
      COALESCE(b.reconciled_transactions, 0) AS reconciled_transactions,
      COALESCE(b.pending_transactions, 0) AS pending_transactions,
      COALESCE(e.open_exceptions, 0) AS open_exceptions
    FROM series s
    LEFT JOIN bank_activity b ON b.day = s.day
    LEFT JOIN exception_activity e ON e.day = s.day
    ORDER BY s.day`,
    [tenantId, days]
  );

  return trendResult.rows.map(row => ({
    date: row.day.toISOString().slice(0, 10),
    totalTransactions: Number(row.total_transactions || 0),
    reconciledTransactions: Number(row.reconciled_transactions || 0),
    pendingTransactions: Number(row.pending_transactions || 0),
    openExceptions: Number(row.open_exceptions || 0),
  }));
}
