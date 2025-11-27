import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

export interface ReconciliationReportItem {
  bankTransactionId: string;
  ledgerEntryId: string | null;
  date: string;
  amount: number;
  description: string;
  status: 'matched' | 'unmatched';
}

export interface ReconciliationReportSummary {
  totalBankTransactions: number;
  totalLedgerEntries: number;
  matchRate: number;
  discrepancies: number;
}

export interface ReconciliationReportPayload {
  periodStart: string;
  periodEnd: string;
  bankBalance: number;
  ledgerBalance: number;
  difference: number;
  matched: number;
  unmatched: number;
  items: ReconciliationReportItem[];
  summary: ReconciliationReportSummary;
}

export async function buildReconciliationReport(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date,
  accountId?: string
): Promise<ReconciliationReportPayload> {
  const bankQuery = await db.query<{
    id: string;
    date: Date;
    amount: number | string;
    description: string;
    reconciled_with_ledger: string | null;
    reconciled: boolean;
  }>(
    `SELECT id, date, amount, description, reconciled_with_ledger, reconciled
       FROM bank_transactions
      WHERE tenant_id = $1
        AND date BETWEEN $2 AND $3
        ${accountId ? 'AND account_id = $4' : ''}`,
    accountId ? [tenantId, periodStart, periodEnd, accountId] : [tenantId, periodStart, periodEnd]
  );

  const ledgerQuery = await db.query<{ total: number | string; balance: number | string }>(
    `SELECT COUNT(*)::int as total, COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END), 0) AS balance
       FROM ledger_entries
      WHERE tenant_id = $1
        AND transaction_date BETWEEN $2 AND $3
        ${accountId ? "AND metadata ->> 'accountId' = $4" : ''}`,
    accountId ? [tenantId, periodStart, periodEnd, accountId] : [tenantId, periodStart, periodEnd]
  );

  const items: ReconciliationReportItem[] = bankQuery.rows.map((row) => ({
    bankTransactionId: row.id,
    ledgerEntryId: row.reconciled_with_ledger,
    date: row.date.toISOString(),
    amount: typeof row.amount === 'number' ? row.amount : parseFloat(String(row.amount)),
    description: row.description,
    status: row.reconciled ? 'matched' : 'unmatched',
  }));

  const matched = items.filter((item) => item.status === 'matched').length;
  const unmatched = items.length - matched;

  const summary: ReconciliationReportSummary = {
    totalBankTransactions: items.length,
    totalLedgerEntries: parseInt(String(ledgerQuery.rows[0]?.total || 0), 10),
    matchRate: items.length ? matched / items.length : 0,
    discrepancies: unmatched,
  };

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    bankBalance: items.reduce((acc, item) => acc + item.amount, 0),
    ledgerBalance: parseFloat(String(ledgerQuery.rows[0]?.balance || 0)),
    difference:
      items.reduce((acc, item) => acc + item.amount, 0) -
      parseFloat(String(ledgerQuery.rows[0]?.balance || 0)),
    matched,
    unmatched,
    items,
    summary,
  };
}
