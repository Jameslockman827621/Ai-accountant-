import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('reconciliation-service');

interface MatchCandidate {
  documentId: string;
  ledgerEntryId: string;
  score: number;
  reason: string;
}

export async function findMatches(
  tenantId: TenantId,
  bankTransactionId: string
): Promise<MatchCandidate[]> {
  // Get bank transaction
  const transactionResult = await db.query(
    'SELECT * FROM bank_transactions WHERE id = $1 AND tenant_id = $2',
    [bankTransactionId, tenantId]
  );

  if (transactionResult.rows.length === 0) {
    return [];
  }

  const transaction = transactionResult.rows[0];
  const candidates: MatchCandidate[] = [];

  // Match by amount and date proximity
  const dateRangeStart = new Date(transaction.date);
  dateRangeStart.setDate(dateRangeStart.getDate() - 7); // 7 days before
  const dateRangeEnd = new Date(transaction.date);
  dateRangeEnd.setDate(dateRangeEnd.getDate() + 7); // 7 days after

  // Find matching documents
  const documentsResult = await db.query(
    `SELECT d.id, d.extracted_data, d.document_type
     FROM documents d
     WHERE d.tenant_id = $1
       AND d.status = 'posted'
       AND d.extracted_data->>'total' IS NOT NULL
       AND ABS((d.extracted_data->>'total')::numeric - $2) < 0.01
       AND (d.extracted_data->>'date')::date BETWEEN $3 AND $4
     ORDER BY ABS((d.extracted_data->>'date')::date - $5::date)`,
    [tenantId, transaction.amount, dateRangeStart, dateRangeEnd, transaction.date]
  );

  for (const doc of documentsResult.rows) {
    const extractedData = doc.extracted_data || {};
    const docTotal = parseFloat(extractedData.total || '0');
    const docDate = extractedData.date ? new Date(extractedData.date) : null;

    let score = 0.5; // Base score
    const reasons: string[] = [];

    // Amount match
    if (Math.abs(docTotal - transaction.amount) < 0.01) {
      score += 0.3;
      reasons.push('exact amount match');
    }

    // Date proximity
    if (docDate) {
      const daysDiff = Math.abs((docDate.getTime() - new Date(transaction.date).getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff <= 1) {
        score += 0.2;
        reasons.push('date within 1 day');
      } else if (daysDiff <= 3) {
        score += 0.1;
        reasons.push('date within 3 days');
      }
    }

    // Description similarity (simple keyword matching)
    const transactionDesc = (transaction.description || '').toLowerCase();
    const docDesc = (extractedData.description || extractedData.vendor || '').toLowerCase();
    if (transactionDesc && docDesc) {
      const commonWords = transactionDesc.split(' ').filter((word: string) => docDesc.includes(word));
      if (commonWords.length > 0) {
        score += 0.1;
        reasons.push('description similarity');
      }
    }

    candidates.push({
      documentId: doc.id,
      ledgerEntryId: '', // Will be filled if ledger entry exists
      score: Math.min(1.0, score),
      reason: reasons.join(', '),
    });
  }

  // Find matching ledger entries
  const ledgerResult = await db.query(
    `SELECT le.id, le.amount, le.transaction_date, le.description
     FROM ledger_entries le
     WHERE le.tenant_id = $1
       AND le.reconciled = false
       AND ABS(le.amount - $2) < 0.01
       AND le.transaction_date BETWEEN $3 AND $4
     ORDER BY ABS(le.transaction_date - $5::date)`,
    [tenantId, transaction.amount, dateRangeStart, dateRangeEnd, transaction.date]
  );

  for (const entry of ledgerResult.rows) {
    let score = 0.5;
    const reasons: string[] = [];

    if (Math.abs(entry.amount - transaction.amount) < 0.01) {
      score += 0.3;
      reasons.push('exact amount match');
    }

    const daysDiff = Math.abs((new Date(entry.transaction_date).getTime() - new Date(transaction.date).getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 1) {
      score += 0.2;
      reasons.push('date within 1 day');
    }

    candidates.push({
      documentId: '',
      ledgerEntryId: entry.id,
      score: Math.min(1.0, score),
      reason: reasons.join(', '),
    });
  }

  // Sort by score descending
  return candidates.sort((a, b) => b.score - a.score);
}

export async function reconcileTransaction(
  tenantId: TenantId,
  bankTransactionId: string,
  documentId?: string,
  ledgerEntryId?: string
): Promise<void> {
  if (!documentId && !ledgerEntryId) {
    throw new Error('Either documentId or ledgerEntryId must be provided');
  }

  await db.transaction(async (client) => {
    // Update bank transaction
    await client.query(
      `UPDATE bank_transactions
       SET reconciled = true,
           reconciled_with_document = $1,
           reconciled_with_ledger = $2,
           updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4`,
      [documentId || null, ledgerEntryId || null, bankTransactionId, tenantId]
    );

    // Update document if provided
    if (documentId) {
      await client.query(
        `UPDATE documents
         SET status = 'posted', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [documentId, tenantId]
      );
    }

    // Update ledger entry if provided
    if (ledgerEntryId) {
      await client.query(
        `UPDATE ledger_entries
         SET reconciled = true, reconciled_with = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [bankTransactionId, ledgerEntryId, tenantId]
      );
    }

    logger.info('Transaction reconciled', { bankTransactionId, documentId, ledgerEntryId, tenantId });
  });
}
