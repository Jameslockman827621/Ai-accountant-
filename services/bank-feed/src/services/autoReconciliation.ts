import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { findFuzzyMatches } from '../../reconciliation/src/services/advancedMatching';

const logger = createLogger('bank-feed-service');

/**
 * Automatically reconcile bank transactions with ledger entries
 */
export async function autoReconcileBankTransactions(
  tenantId: TenantId,
  accountId: string,
  threshold: number = 0.85
): Promise<{
  reconciled: number;
  pending: number;
  unmatched: number;
}> {
  logger.info('Auto-reconciling bank transactions', { tenantId, accountId });

  // Get unreconciled transactions
  const transactions = await db.query<{
    id: string;
    amount: number;
    description: string;
    date: Date;
  }>(
    `SELECT id, amount, description, date
     FROM bank_transactions
     WHERE tenant_id = $1
       AND account_id = $2
       AND reconciled = false
     ORDER BY date DESC`,
    [tenantId, accountId]
  );

  let reconciled = 0;
  let pending = 0;
  let unmatched = 0;

  for (const transaction of transactions.rows) {
    // Find matches
    const matches = await findFuzzyMatches(tenantId, transaction.id, threshold);

    if (matches.length > 0 && matches[0].similarity >= threshold) {
      // Auto-reconcile with best match
      const bestMatch = matches[0];
      
      if (bestMatch.type === 'ledger_entry') {
        await db.query(
          `UPDATE bank_transactions
           SET reconciled = true, reconciled_at = NOW(), ledger_entry_id = $1
           WHERE id = $2 AND tenant_id = $3`,
          [bestMatch.id, transaction.id, tenantId]
        );

        await db.query(
          `UPDATE ledger_entries
           SET reconciled = true, reconciled_at = NOW()
           WHERE id = $1 AND tenant_id = $2`,
          [bestMatch.id, tenantId]
        );

        reconciled++;
      } else if (bestMatch.type === 'document') {
        await db.query(
          `UPDATE bank_transactions
           SET reconciled = true, reconciled_at = NOW(), document_id = $1
           WHERE id = $2 AND tenant_id = $3`,
          [bestMatch.id, transaction.id, tenantId]
        );

        reconciled++;
      }
    } else if (matches.length > 0) {
      // Has matches but below threshold - needs review
      pending++;
    } else {
      // No matches found
      unmatched++;
    }
  }

  logger.info('Auto-reconciliation completed', { tenantId, reconciled, pending, unmatched });
  return { reconciled, pending, unmatched };
}

/**
 * Suggest reconciliation matches for manual review
 */
export async function getReconciliationSuggestions(
  tenantId: TenantId,
  accountId: string
): Promise<Array<{
  transactionId: string;
  suggestions: Array<{
    id: string;
    type: 'ledger_entry' | 'document';
    description: string;
    amount: number;
    date: Date;
    similarity: number;
    confidence: number;
  }>;
}>> {
  const transactions = await db.query<{ id: string }>(
    `SELECT id FROM bank_transactions
     WHERE tenant_id = $1 AND account_id = $2 AND reconciled = false
     LIMIT 50`,
    [tenantId, accountId]
  );

  const suggestions: Array<{
    transactionId: string;
    suggestions: Array<{
      id: string;
      type: 'ledger_entry' | 'document';
      description: string;
      amount: number;
      date: Date;
      similarity: number;
      confidence: number;
    }>;
  }> = [];

  for (const transaction of transactions.rows) {
    const matches = await findFuzzyMatches(tenantId, transaction.id, 0.6); // Lower threshold for suggestions

    if (matches.length > 0) {
      suggestions.push({
        transactionId: transaction.id,
        suggestions: matches.slice(0, 5).map(m => ({
          id: m.id,
          type: m.type,
          description: m.description,
          amount: m.amount,
          date: m.date,
          similarity: m.similarity,
          confidence: m.similarity,
        })),
      });
    }
  }

  return suggestions;
}
