import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('reconciliation-service');

export interface MatchCandidate {
  id: string;
  type: 'ledger_entry' | 'document';
  description: string;
  amount: number;
  date: Date;
  similarity: number;
  matchReasons: string[];
}

export async function findFuzzyMatches(
  tenantId: TenantId,
  transactionId: string,
  threshold: number = 0.7
): Promise<MatchCandidate[]> {
  // Get the bank transaction
  const txResult = await db.query<{
    amount: number;
    description: string;
    date: Date;
  }>(
    'SELECT amount, description, date FROM bank_transactions WHERE id = $1 AND tenant_id = $2',
    [transactionId, tenantId]
  );

  if (txResult.rows.length === 0) {
    return [];
  }

  const transaction = txResult.rows[0];
  const candidates: MatchCandidate[] = [];

  // Find ledger entry matches
  const ledgerMatches = await db.query<{
    id: string;
    description: string;
    amount: number;
    transaction_date: Date;
  }>(
    `SELECT id, description, amount, transaction_date
     FROM ledger_entries
     WHERE tenant_id = $1
       AND ABS(amount - $2) < 0.01
       AND transaction_date BETWEEN $3 - INTERVAL '7 days' AND $3 + INTERVAL '7 days'
       AND reconciled = false`,
    [tenantId, transaction.amount, transaction.date]
  );

  for (const entry of ledgerMatches.rows) {
    const similarity = calculateSimilarity(
      transaction.description,
      entry.description,
      transaction.amount,
      entry.amount,
      transaction.date,
      entry.transaction_date
    );

    if (similarity >= threshold) {
      candidates.push({
        id: entry.id,
        type: 'ledger_entry',
        description: entry.description,
        amount: entry.amount,
        date: entry.transaction_date,
        similarity,
        matchReasons: generateMatchReasons(transaction, entry, similarity),
      });
    }
  }

  // Find document matches
  const docMatches = await db.query<{
    id: string;
    file_name: string;
    extracted_data: unknown;
    created_at: Date;
  }>(
    `SELECT id, file_name, extracted_data, created_at
     FROM documents
     WHERE tenant_id = $1
       AND status IN ('classified', 'extracted')
       AND created_at BETWEEN $2 - INTERVAL '7 days' AND $2 + INTERVAL '7 days'`,
    [tenantId, transaction.date]
  );

  for (const doc of docMatches.rows) {
    const extracted = doc.extracted_data as Record<string, unknown> | null;
    if (extracted?.total) {
      const docAmount = typeof extracted.total === 'number' 
        ? extracted.total 
        : parseFloat(String(extracted.total || '0'));
      
      const similarity = calculateSimilarity(
        transaction.description,
        doc.file_name,
        transaction.amount,
        docAmount,
        transaction.date,
        doc.created_at
      );

      if (similarity >= threshold) {
        candidates.push({
          id: doc.id,
          type: 'document',
          description: doc.file_name,
          amount: docAmount,
          date: doc.created_at,
          similarity,
          matchReasons: generateMatchReasons(transaction, { description: doc.file_name, amount: docAmount, date: doc.created_at }, similarity),
        });
      }
    }
  }

  return candidates.sort((a, b) => b.similarity - a.similarity);
}

function calculateSimilarity(
  desc1: string,
  desc2: string,
  amount1: number,
  amount2: number,
  date1: Date,
  date2: Date
): number {
  // Amount similarity (exact match = 1.0, within 1% = 0.9, etc.)
  const amountDiff = Math.abs(amount1 - amount2);
  const amountSimilarity = amountDiff < 0.01 ? 1.0 : 
    amountDiff < Math.abs(amount1) * 0.01 ? 0.9 :
    amountDiff < Math.abs(amount1) * 0.05 ? 0.7 : 0.3;

  // Description similarity (Levenshtein-based)
  const descSimilarity = levenshteinSimilarity(desc1.toLowerCase(), desc2.toLowerCase());

  // Date similarity (same day = 1.0, within 1 day = 0.9, etc.)
  const dateDiff = Math.abs(date1.getTime() - date2.getTime());
  const daysDiff = dateDiff / (1000 * 60 * 60 * 24);
  const dateSimilarity = daysDiff === 0 ? 1.0 :
    daysDiff <= 1 ? 0.9 :
    daysDiff <= 3 ? 0.7 :
    daysDiff <= 7 ? 0.5 : 0.2;

  // Weighted combination
  return (amountSimilarity * 0.5) + (descSimilarity * 0.3) + (dateSimilarity * 0.2);
}

function levenshteinSimilarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(str1, str2);
  return 1 - (distance / maxLen);
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

function generateMatchReasons(
  transaction: { description: string; amount: number; date: Date },
  candidate: { description: string; amount: number; date: Date },
  similarity: number
): string[] {
  const reasons: string[] = [];

  if (Math.abs(transaction.amount - candidate.amount) < 0.01) {
    reasons.push('Exact amount match');
  } else if (Math.abs(transaction.amount - candidate.amount) < Math.abs(transaction.amount) * 0.01) {
    reasons.push('Amount within 1%');
  }

  const dateDiff = Math.abs(transaction.date.getTime() - candidate.date.getTime()) / (1000 * 60 * 60 * 24);
  if (dateDiff === 0) {
    reasons.push('Same date');
  } else if (dateDiff <= 1) {
    reasons.push('Date within 1 day');
  }

  if (levenshteinSimilarity(transaction.description.toLowerCase(), candidate.description.toLowerCase()) > 0.8) {
    reasons.push('Description similarity > 80%');
  }

  if (similarity > 0.9) {
    reasons.push('High overall match confidence');
  }

  return reasons;
}
