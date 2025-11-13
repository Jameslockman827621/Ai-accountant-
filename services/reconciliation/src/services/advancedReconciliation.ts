import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getAccountBalance } from './reconciliation';

const logger = createLogger('reconciliation-service');

export interface ReconciliationMatch {
  transactionId: string;
  documentId?: string;
  ledgerEntryId?: string;
  matchScore: number;
  matchType: 'exact' | 'fuzzy' | 'suggested';
  confidence: number;
  differences: Array<{ field: string; transactionValue: unknown; matchedValue: unknown }>;
  reasoning: string;
}

export interface ReconciliationSuggestion {
  transactionId: string;
  suggestedMatches: ReconciliationMatch[];
  requiresReview: boolean;
  autoReconcilePossible: boolean;
}

/**
 * Advanced reconciliation with fuzzy matching and ML-based suggestions
 */
export async function findAdvancedMatches(
  tenantId: TenantId,
  transactionId: string,
  tolerance: number = 0.01
): Promise<ReconciliationSuggestion> {
  logger.info('Finding advanced matches', { tenantId, transactionId });

  // Get the bank transaction
  const transaction = await db.query<{
    id: string;
    amount: number;
    description: string;
    date: Date;
    currency: string;
  }>(
    'SELECT id, amount, description, date, currency FROM bank_transactions WHERE id = $1 AND tenant_id = $2',
    [transactionId, tenantId]
  );

  if (transaction.rows.length === 0) {
    throw new Error('Transaction not found');
  }

  const tx = transaction.rows[0];
  const matches: ReconciliationMatch[] = [];

  // 1. Exact amount matches (within tolerance)
  const exactMatches = await db.query<{
    id: string;
    type: string;
    amount: number;
    description: string;
    date: Date;
    account_code: string;
  }>(
    `SELECT 
       le.id,
       'ledger_entry' as type,
       le.amount,
       le.description,
       le.transaction_date as date,
       le.account_code
     FROM ledger_entries le
     WHERE le.tenant_id = $1
       AND ABS(le.amount - $2) <= $3
       AND le.transaction_date BETWEEN $4 - INTERVAL '7 days' AND $4 + INTERVAL '7 days'
       AND NOT EXISTS (
         SELECT 1 FROM reconciliation_matches rm 
         WHERE rm.ledger_entry_id = le.id AND rm.tenant_id = $1
       )
     UNION ALL
     SELECT 
       d.id,
       'document' as type,
       (d.extracted_data->>'total')::numeric as amount,
       d.file_name as description,
       (d.extracted_data->>'date')::date as date,
       NULL as account_code
     FROM documents d
     WHERE d.tenant_id = $1
       AND d.extracted_data->>'total' IS NOT NULL
       AND ABS((d.extracted_data->>'total')::numeric - $2) <= $3
       AND (d.extracted_data->>'date')::date BETWEEN $4 - INTERVAL '7 days' AND $4 + INTERVAL '7 days'
       AND d.status = 'classified'
       AND NOT EXISTS (
         SELECT 1 FROM reconciliation_matches rm 
         WHERE rm.document_id = d.id AND rm.tenant_id = $1
       )`,
    [tenantId, Math.abs(tx.amount), tolerance, tx.date]
  );

  for (const match of exactMatches.rows) {
    const amountDiff = Math.abs(Math.abs(tx.amount) - Math.abs(match.amount));
    const dateDiff = Math.abs((tx.date.getTime() - new Date(match.date).getTime()) / (1000 * 60 * 60 * 24));
    
    let matchScore = 1.0;
    let matchType: 'exact' | 'fuzzy' | 'suggested' = 'exact';
    let confidence = 0.95;

    // Adjust score based on date difference
    if (dateDiff > 0) {
      matchScore -= dateDiff * 0.05; // Reduce score by 5% per day difference
      if (dateDiff > 3) {
        matchType = 'fuzzy';
        confidence = 0.75;
      }
    }

    // Adjust score based on amount difference
    if (amountDiff > 0) {
      matchScore -= (amountDiff / Math.abs(tx.amount)) * 0.1;
      if (amountDiff > tolerance) {
        matchType = 'fuzzy';
        confidence = Math.max(0.6, confidence - 0.2);
      }
    }

    // Description similarity
    const descSimilarity = calculateStringSimilarity(
      tx.description.toLowerCase(),
      match.description.toLowerCase()
    );
    matchScore = matchScore * 0.7 + descSimilarity * 0.3;

    if (matchScore < 0.7) {
      matchType = 'suggested';
      confidence = 0.5;
    }

    matches.push({
      transactionId: tx.id,
      documentId: match.type === 'document' ? match.id : undefined,
      ledgerEntryId: match.type === 'ledger_entry' ? match.id : undefined,
      matchScore: Math.max(0, Math.min(1, matchScore)),
      matchType,
      confidence,
      differences: [
        { field: 'amount', transactionValue: tx.amount, matchedValue: match.amount },
        { field: 'date', transactionValue: tx.date, matchedValue: match.date },
      ],
      reasoning: `Matched by ${matchType} matching: amount difference ${amountDiff.toFixed(2)}, date difference ${dateDiff.toFixed(1)} days, description similarity ${(descSimilarity * 100).toFixed(1)}%`,
    });
  }

  // 2. Fuzzy matches (similar amount, similar description)
  if (matches.length === 0 || matches[0].matchScore < 0.9) {
    const fuzzyMatches = await findFuzzyMatches(tenantId, tx, tolerance * 2);
    matches.push(...fuzzyMatches);
  }

  // Sort by match score
  matches.sort((a, b) => b.matchScore - a.matchScore);

  // Determine if auto-reconciliation is possible
  const bestMatch = matches[0];
  const autoReconcilePossible = bestMatch && bestMatch.matchScore >= 0.95 && bestMatch.confidence >= 0.9;
  const requiresReview = !autoReconcilePossible || matches.length > 1;

  return {
    transactionId,
    suggestedMatches: matches.slice(0, 5), // Top 5 matches
    requiresReview,
    autoReconcilePossible: !!autoReconcilePossible,
  };
}

async function findFuzzyMatches(
  tenantId: TenantId,
  transaction: { amount: number; description: string; date: Date },
  tolerance: number
): Promise<ReconciliationMatch[]> {
  const matches: ReconciliationMatch[] = [];

  // Find transactions with similar amounts (within 10% or £50)
  const similarAmount = await db.query<{
    id: string;
    type: string;
    amount: number;
    description: string;
    date: Date;
  }>(
    `SELECT 
       le.id,
       'ledger_entry' as type,
       le.amount,
       le.description,
       le.transaction_date as date
     FROM ledger_entries le
     WHERE le.tenant_id = $1
       AND (
         ABS(le.amount - $2) <= GREATEST($3, ABS($2) * 0.1)
         OR ABS(le.amount - $2) <= 50
       )
       AND le.transaction_date BETWEEN $4 - INTERVAL '30 days' AND $4 + INTERVAL '30 days'
       AND NOT EXISTS (
         SELECT 1 FROM reconciliation_matches rm 
         WHERE rm.ledger_entry_id = le.id AND rm.tenant_id = $1
       )
     LIMIT 10`,
    [tenantId, Math.abs(transaction.amount), tolerance, transaction.date]
  );

  for (const match of similarAmount.rows) {
    const amountSimilarity = 1 - Math.min(1, Math.abs(Math.abs(transaction.amount) - Math.abs(match.amount)) / Math.abs(transaction.amount));
    const descSimilarity = calculateStringSimilarity(
      transaction.description.toLowerCase(),
      match.description.toLowerCase()
    );
    const dateDiff = Math.abs((transaction.date.getTime() - new Date(match.date).getTime()) / (1000 * 60 * 60 * 24));
    const dateSimilarity = Math.max(0, 1 - dateDiff / 30); // 30 day window

    const matchScore = (amountSimilarity * 0.4 + descSimilarity * 0.4 + dateSimilarity * 0.2);
    const confidence = matchScore >= 0.8 ? 0.7 : matchScore >= 0.6 ? 0.5 : 0.3;

    if (matchScore >= 0.6) {
      matches.push({
        transactionId: transaction as unknown as string,
        ledgerEntryId: match.id,
        matchScore,
        matchType: 'fuzzy',
        confidence,
        differences: [
          { field: 'amount', transactionValue: transaction.amount, matchedValue: match.amount },
          { field: 'description', transactionValue: transaction.description, matchedValue: match.description },
          { field: 'date', transactionValue: transaction.date, matchedValue: match.date },
        ],
        reasoning: `Fuzzy match: amount similarity ${(amountSimilarity * 100).toFixed(1)}%, description similarity ${(descSimilarity * 100).toFixed(1)}%, date similarity ${(dateSimilarity * 100).toFixed(1)}%`,
      });
    }
  }

  return matches;
}

function calculateStringSimilarity(str1: string, str2: string): number {
  // Levenshtein distance-based similarity
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const distance = levenshteinDistance(longer, shorter);
  return (longer.length - distance) / longer.length;
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

/**
 * Auto-reconcile high-confidence matches
 */
export async function autoReconcileHighConfidence(
  tenantId: TenantId,
  minConfidence: number = 0.95
): Promise<number> {
  logger.info('Auto-reconciling high confidence matches', { tenantId, minConfidence });

  // Get all unreconciled transactions
  const transactions = await db.query<{
    id: string;
    amount: number;
    description: string;
    date: Date;
  }>(
    `SELECT id, amount, description, date
     FROM bank_transactions
     WHERE tenant_id = $1
       AND reconciled = false
     ORDER BY date DESC
     LIMIT 100`,
    [tenantId]
  );

  let reconciled = 0;

  for (const tx of transactions.rows) {
    const suggestion = await findAdvancedMatches(tenantId, tx.id);
    const bestMatch = suggestion.suggestedMatches[0];

    if (bestMatch && bestMatch.matchScore >= minConfidence && bestMatch.confidence >= 0.9) {
      try {
        if (bestMatch.ledgerEntryId) {
          await db.query(
            `INSERT INTO reconciliation_matches (
              id, tenant_id, transaction_id, ledger_entry_id, match_score, confidence, created_at
            ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
            ON CONFLICT DO NOTHING`,
            [tenantId, tx.id, bestMatch.ledgerEntryId, bestMatch.matchScore, bestMatch.confidence]
          );

          await db.query(
            'UPDATE bank_transactions SET reconciled = true, updated_at = NOW() WHERE id = $1',
            [tx.id]
          );

          reconciled++;
          logger.info('Auto-reconciled transaction', { transactionId: tx.id, matchScore: bestMatch.matchScore });
        }
      } catch (error) {
        logger.error('Auto-reconciliation failed', error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  logger.info('Auto-reconciliation completed', { tenantId, reconciled, total: transactions.rows.length });
  return reconciled;
}
