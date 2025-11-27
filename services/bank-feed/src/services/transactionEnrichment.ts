import { db } from '@ai-accountant/database';
import { createServiceLogger } from '@ai-accountant/observability';
import { TenantId } from '@ai-accountant/shared-types';
import { createLedgerEntry } from '../../../ledger/src/services/ledger';
import { categorizeTransaction } from './transactionCategorization';

const logger = createServiceLogger('bank-feed-enrichment');

export interface RawBankTransaction {
  transactionId: string;
  accountId: string;
  amount: number;
  currency: string;
  description: string;
  date: string;
  merchantName?: string;
  plaidCategory?: string[];
}

export async function enrichAndPostTransactions(
  tenantId: TenantId,
  transactions: RawBankTransaction[]
): Promise<void> {
  if (transactions.length === 0) {
    return;
  }

  for (const tx of transactions) {
    try {
      const categorization = await categorizeTransaction(
        tenantId,
        tx.transactionId,
        tx.amount,
        tx.description,
        tx.merchantName,
        tx.plaidCategory
      );

      await db.query(
        `UPDATE bank_transactions
         SET category = $1, account_code = $2, categorization_confidence = $3,
             enrichment_metadata = $4::jsonb, enriched_at = NOW()
         WHERE tenant_id = $5 AND transaction_id = $6`,
        [
          categorization.category,
          categorization.accountCode,
          categorization.confidence,
          JSON.stringify({
            reasoning: categorization.reasoning,
            plaidCategory: tx.plaidCategory,
          }),
          tenantId,
          tx.transactionId,
        ]
      );

      const bankAccountCode = '1100';
      const description = tx.description || tx.merchantName || 'Bank transaction';
      const amountAbs = Math.abs(tx.amount);
      const isCredit = tx.amount > 0;

      const debitAccount = isCredit ? bankAccountCode : categorization.accountCode;
      const creditAccount = isCredit ? categorization.accountCode : bankAccountCode;

      const debitEntry = await createLedgerEntry({
        tenantId,
        entryType: 'debit',
        amount: amountAbs,
        accountCode: debitAccount,
        accountName: debitAccount === bankAccountCode ? 'Cash' : categorization.category,
        description,
        transactionDate: new Date(tx.date),
        metadata: { transactionId: tx.transactionId, source: 'bank_feed' },
      });

      const creditEntry = await createLedgerEntry({
        tenantId,
        entryType: 'credit',
        amount: amountAbs,
        accountCode: creditAccount,
        accountName: creditAccount === bankAccountCode ? 'Cash' : categorization.category,
        description,
        transactionDate: new Date(tx.date),
        metadata: { transactionId: tx.transactionId, source: 'bank_feed' },
      });

      await db.query(
        `UPDATE bank_transactions
         SET ledger_entry_id = $1, reconciliation_status = 'pending_ledger_posting'
         WHERE tenant_id = $2 AND transaction_id = $3`,
        [creditEntry, tenantId, tx.transactionId]
      );

      logger.info('Transaction enriched and posted to ledger', {
        tenantId,
        transactionId: tx.transactionId,
        category: categorization.category,
      });
    } catch (error) {
      logger.error('Failed to enrich or post transaction', error instanceof Error ? error : new Error(String(error)), {
        tenantId,
        transactionId: tx.transactionId,
      });
    }
  }
}
