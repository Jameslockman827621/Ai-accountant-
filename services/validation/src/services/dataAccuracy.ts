import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('validation-service');

export interface AccuracyCheck {
  check: string;
  passed: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export async function checkDataAccuracy(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<AccuracyCheck[]> {
  logger.info('Checking data accuracy', { tenantId, periodStart, periodEnd });

  const checks: AccuracyCheck[] = [];

  // Check 1: Ledger balances
  const balanceResult = await db.query<{
    entry_type: string;
    total: number;
  }>(
    `SELECT entry_type, SUM(amount) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
     GROUP BY entry_type`,
    [tenantId, periodStart, periodEnd]
  );

  let totalDebits = 0;
  let totalCredits = 0;

  for (const row of balanceResult.rows) {
    if (row.entry_type === 'debit') {
      totalDebits = typeof row.total === 'number' ? row.total : parseFloat(String(row.total || '0'));
    } else {
      totalCredits = typeof row.total === 'number' ? row.total : parseFloat(String(row.total || '0'));
    }
  }

  // In double-entry accounting, debits should equal credits (approximately)
  const balanceDifference = Math.abs(totalDebits - totalCredits);
  checks.push({
    check: 'Double-entry balance',
    passed: balanceDifference < 0.01,
    message: balanceDifference < 0.01
      ? 'Ledger is balanced'
      : `Ledger imbalance: ${balanceDifference.toFixed(2)}`,
    details: { totalDebits, totalCredits, difference: balanceDifference },
  });

  // Check 2: Document reconciliation
  const documentResult = await db.query<{
    total: number;
    posted: number;
  }>(
    `SELECT 
       COUNT(*) as total,
       SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) as posted
     FROM documents
     WHERE tenant_id = $1
       AND created_at BETWEEN $2 AND $3`,
    [tenantId, periodStart, periodEnd]
  );

  const totalDocs = typeof documentResult.rows[0]?.total === 'number'
    ? documentResult.rows[0].total
    : parseInt(String(documentResult.rows[0]?.total || '0'), 10);
  const postedDocs = typeof documentResult.rows[0]?.posted === 'number'
    ? documentResult.rows[0].posted
    : parseInt(String(documentResult.rows[0]?.posted || '0'), 10);

  const postingRate = totalDocs > 0 ? postedDocs / totalDocs : 1;
  checks.push({
    check: 'Document posting rate',
    passed: postingRate >= 0.9,
    message: `${(postingRate * 100).toFixed(1)}% of documents posted to ledger`,
    details: { totalDocs, postedDocs, postingRate },
  });

  // Check 3: Bank reconciliation
  const bankResult = await db.query<{
    total: number;
    reconciled: number;
  }>(
    `SELECT 
       COUNT(*) as total,
       SUM(CASE WHEN reconciled = true THEN 1 ELSE 0 END) as reconciled
     FROM bank_transactions
     WHERE tenant_id = $1
       AND date BETWEEN $2 AND $3`,
    [tenantId, periodStart, periodEnd]
  );

  const totalBank = typeof bankResult.rows[0]?.total === 'number'
    ? bankResult.rows[0].total
    : parseInt(String(bankResult.rows[0]?.total || '0'), 10);
  const reconciledBank = typeof bankResult.rows[0]?.reconciled === 'number'
    ? bankResult.rows[0].reconciled
    : parseInt(String(bankResult.rows[0]?.reconciled || '0'), 10);

  const reconciliationRate = totalBank > 0 ? reconciledBank / totalBank : 1;
  checks.push({
    check: 'Bank reconciliation rate',
    passed: reconciliationRate >= 0.8,
    message: `${(reconciliationRate * 100).toFixed(1)}% of bank transactions reconciled`,
    details: { totalBank, reconciledBank, reconciliationRate },
  });

  // Check 4: Tax amount consistency
  const taxResult = await db.query<{
    entry_count: number;
    tax_sum: number;
    tax_amount_sum: number;
  }>(
    `SELECT 
       COUNT(*) as entry_count,
       SUM(COALESCE(tax_rate, 0) * amount) as tax_sum,
       SUM(COALESCE(tax_amount, 0)) as tax_amount_sum
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
       AND tax_amount IS NOT NULL`,
    [tenantId, periodStart, periodEnd]
  );

  const calculatedTax = typeof taxResult.rows[0]?.tax_sum === 'number'
    ? taxResult.rows[0].tax_sum
    : parseFloat(String(taxResult.rows[0]?.tax_sum || '0'));
  const recordedTax = typeof taxResult.rows[0]?.tax_amount_sum === 'number'
    ? taxResult.rows[0].tax_amount_sum
    : parseFloat(String(taxResult.rows[0]?.tax_amount_sum || '0'));

  const taxDifference = Math.abs(calculatedTax - recordedTax);
  checks.push({
    check: 'Tax amount consistency',
    passed: taxDifference < 1.0,
    message: taxDifference < 1.0
      ? 'Tax amounts are consistent'
      : `Tax amount discrepancy: ${taxDifference.toFixed(2)}`,
    details: { calculatedTax, recordedTax, difference: taxDifference },
  });

  const highValueResult = await db.query<{ pending: number }>(
    `SELECT COUNT(*) as pending
       FROM documents
      WHERE tenant_id = $1
        AND created_at BETWEEN $2 AND $3
        AND status <> 'posted'
        AND COALESCE((extracted_data->>'total')::numeric, 0) >= $4`,
    [tenantId, periodStart, periodEnd, 1000]
  );
  const pendingHighValue = parseInt(String(highValueResult.rows[0]?.pending ?? '0'), 10);
  checks.push({
    check: 'High-value documents posted',
    passed: pendingHighValue === 0,
    message:
      pendingHighValue === 0
        ? 'All high-value documents are posted'
        : `${pendingHighValue} high-value documents awaiting posting`,
    details: { pendingHighValue, threshold: 1000 },
  });

  const staleConnectionsResult = await db.query<{ stale: number }>(
    `SELECT COUNT(*) as stale
       FROM bank_connections
      WHERE tenant_id = $1
        AND is_active = true
        AND (last_sync IS NULL OR last_sync < NOW() - INTERVAL '5 days')`,
    [tenantId]
  );
  const staleConnections = parseInt(String(staleConnectionsResult.rows[0]?.stale ?? '0'), 10);
  checks.push({
    check: 'Bank feed freshness',
    passed: staleConnections === 0,
    message:
      staleConnections === 0
        ? 'All active bank feeds synced recently'
        : `${staleConnections} bank connections need refreshing`,
    details: { staleConnections },
  });

  const orphanedEntriesResult = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count
       FROM ledger_entries
      WHERE tenant_id = $1
        AND transaction_date BETWEEN $2 AND $3
        AND document_id IS NULL`,
    [tenantId, periodStart, periodEnd]
  );
  const orphanedEntries = parseInt(String(orphanedEntriesResult.rows[0]?.count ?? '0'), 10);
  checks.push({
    check: 'Ledger-document linkage',
    passed: orphanedEntries === 0,
    message:
      orphanedEntries === 0
        ? 'All ledger entries reference source documents'
        : `${orphanedEntries} ledger entries missing source documents`,
    details: { orphanedEntries },
  });

  return checks;
}
