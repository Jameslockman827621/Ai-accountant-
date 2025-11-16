import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('bank-feed-service');

export interface ReconciliationItem {
  bankTransactionId: string;
  ledgerEntryId: string | null;
  documentId: string | null;
  date: Date;
  amount: number;
  description: string;
  status: 'matched' | 'unmatched' | 'partial';
  discrepancy?: number;
}

export interface ReconciliationReport {
  periodStart: Date;
  periodEnd: Date;
  bankBalance: number;
  ledgerBalance: number;
  difference: number;
  matched: number;
  unmatched: number;
  items: ReconciliationItem[];
  summary: {
    totalBankTransactions: number;
    totalLedgerEntries: number;
    matchRate: number;
    discrepancies: number;
  };
}

/**
 * Generate reconciliation report comparing bank transactions with ledger entries
 */
export async function generateReconciliationReport(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date,
  accountId?: string
): Promise<ReconciliationReport> {
  logger.info('Generating reconciliation report', { tenantId, periodStart, periodEnd, accountId });

  // Get bank transactions
  let bankQuery = `SELECT 
     id, date, amount, description, reconciled, reconciled_with_ledger
   FROM bank_transactions
   WHERE tenant_id = $1
     AND date BETWEEN $2 AND $3`;

  const bankParams: unknown[] = [tenantId, periodStart, periodEnd];

  if (accountId) {
    bankQuery += ' AND account_id = $4';
    bankParams.push(accountId);
  }

  bankQuery += ' ORDER BY date, amount';

  const bankResult = await db.query<{
    id: string;
    date: Date;
    amount: number;
    description: string;
    reconciled: boolean;
    reconciled_with_ledger: string | null;
  }>(bankQuery, bankParams);

  // Get ledger entries
  const ledgerResult = await db.query<{
    id: string;
    transaction_date: Date;
    amount: number;
    description: string;
    document_id: string | null;
    reconciled: boolean;
  }>(
    `SELECT id, transaction_date, amount, description, document_id, reconciled
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
     ORDER BY transaction_date, amount`,
    [tenantId, periodStart, periodEnd]
  );

  // Calculate balances
  const bankBalance = bankResult.rows.reduce((sum, tx) => sum + parseFloat(String(tx.amount)), 0);
  const ledgerBalance = ledgerResult.rows.reduce((sum, entry) => {
    const amount = parseFloat(String(entry.amount));
    // Debits increase balance, credits decrease (for bank account)
    return sum + (entry.entry_type === 'debit' ? amount : -amount);
  }, 0);

  const difference = Math.abs(bankBalance - ledgerBalance);

  // Match transactions
  const items: ReconciliationItem[] = [];
  const matchedLedgerIds = new Set<string>();

  for (const bankTx of bankResult.rows) {
    const bankAmount = parseFloat(String(bankTx.amount));
    let matched = false;

    // Try to find matching ledger entry
    for (const ledgerEntry of ledgerResult.rows) {
      if (matchedLedgerIds.has(ledgerEntry.id)) {
        continue; // Already matched
      }

      const ledgerAmount = parseFloat(String(ledgerEntry.amount));
      const dateDiff = Math.abs(
        bankTx.date.getTime() - ledgerEntry.transaction_date.getTime()
      );

      // Match if amount is close and date is within 7 days
      if (
        Math.abs(bankAmount - ledgerAmount) < 0.01 &&
        dateDiff < 7 * 24 * 60 * 60 * 1000
      ) {
        items.push({
          bankTransactionId: bankTx.id,
          ledgerEntryId: ledgerEntry.id,
          documentId: ledgerEntry.document_id,
          date: bankTx.date,
          amount: bankAmount,
          description: bankTx.description,
          status: 'matched',
        });

        matchedLedgerIds.add(ledgerEntry.id);
        matched = true;
        break;
      }
    }

    if (!matched) {
      items.push({
        bankTransactionId: bankTx.id,
        ledgerEntryId: null,
        documentId: null,
        date: bankTx.date,
        amount: bankAmount,
        description: bankTx.description,
        status: 'unmatched',
      });
    }
  }

  // Find unmatched ledger entries
  for (const ledgerEntry of ledgerResult.rows) {
    if (!matchedLedgerIds.has(ledgerEntry.id)) {
      const amount = parseFloat(String(ledgerEntry.amount));
      items.push({
        bankTransactionId: '',
        ledgerEntryId: ledgerEntry.id,
        documentId: ledgerEntry.document_id,
        date: ledgerEntry.transaction_date,
        amount,
        description: ledgerEntry.description,
        status: 'unmatched',
      });
    }
  }

  // Sort by date
  items.sort((a, b) => a.date.getTime() - b.date.getTime());

  const matched = items.filter(i => i.status === 'matched').length;
  const unmatched = items.filter(i => i.status === 'unmatched').length;

  return {
    periodStart,
    periodEnd,
    bankBalance,
    ledgerBalance,
    difference,
    matched,
    unmatched,
    items,
    summary: {
      totalBankTransactions: bankResult.rows.length,
      totalLedgerEntries: ledgerResult.rows.length,
      matchRate: bankResult.rows.length > 0 ? matched / bankResult.rows.length : 0,
      discrepancies: unmatched,
    },
  };
}
