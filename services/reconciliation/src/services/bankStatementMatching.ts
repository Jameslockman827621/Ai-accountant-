import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('reconciliation-service');

export interface BankStatement {
  date: Date;
  description: string;
  amount: number;
  balance: number;
  reference?: string;
}

export interface StatementMatch {
  statementLine: BankStatement;
  matchedTransactions: Array<{
    id: string;
    type: 'ledger_entry' | 'bank_transaction';
    amount: number;
    date: Date;
    description: string;
    confidence: number;
  }>;
  matchStatus: 'matched' | 'partial' | 'unmatched';
  difference: number;
}

/**
 * Match bank statement with ledger entries and transactions
 */
export async function matchBankStatement(
  tenantId: TenantId,
  accountId: string,
  statementLines: BankStatement[],
  _periodStart: Date,
  _periodEnd: Date
): Promise<StatementMatch[]> {
  logger.info('Matching bank statement', { tenantId, accountId, lineCount: statementLines.length });

  const matches: StatementMatch[] = [];

  for (const statementLine of statementLines) {
    // Find potential matches
    const ledgerMatches = await db.query<{
      id: string;
      amount: number;
      transaction_date: Date;
      description: string;
    }>(
      `SELECT id, amount, transaction_date, description
       FROM ledger_entries
       WHERE tenant_id = $1
         AND account_code LIKE '11%'
         AND ABS(amount - $2) < 0.01
         AND transaction_date BETWEEN $3 - INTERVAL '7 days' AND $3 + INTERVAL '7 days'
         AND reconciled = false`,
      [tenantId, statementLine.amount, statementLine.date]
    );

    const transactionMatches = await db.query<{
      id: string;
      amount: number;
      date: Date;
      description: string;
    }>(
      `SELECT id, amount, date, description
       FROM bank_transactions
       WHERE tenant_id = $1
         AND account_id = $2
         AND ABS(amount - $3) < 0.01
         AND date BETWEEN $4 - INTERVAL '7 days' AND $4 + INTERVAL '7 days'
         AND reconciled = false`,
      [tenantId, accountId, statementLine.amount, statementLine.date]
    );

    const matchedTransactions = [
      ...ledgerMatches.rows.map(row => ({
        id: row.id,
        type: 'ledger_entry' as const,
        amount: row.amount,
        date: row.transaction_date,
        description: row.description,
        confidence: calculateMatchConfidence(statementLine, { amount: row.amount, date: row.transaction_date, description: row.description }),
      })),
      ...transactionMatches.rows.map(row => ({
        id: row.id,
        type: 'bank_transaction' as const,
        amount: row.amount,
        date: row.date,
        description: row.description,
        confidence: calculateMatchConfidence(statementLine, { amount: row.amount, date: row.date, description: row.description }),
      })),
    ].sort((a, b) => b.confidence - a.confidence);

    const totalMatched = matchedTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const difference = statementLine.amount - totalMatched;

    let matchStatus: 'matched' | 'partial' | 'unmatched';
    if (Math.abs(difference) < 0.01) {
      matchStatus = 'matched';
    } else if (totalMatched > 0) {
      matchStatus = 'partial';
    } else {
      matchStatus = 'unmatched';
    }

    matches.push({
      statementLine,
      matchedTransactions,
      matchStatus,
      difference,
    });
  }

  return matches;
}

function calculateMatchConfidence(
  statement: BankStatement,
  candidate: { amount: number; date: Date; description: string }
): number {
  let confidence = 0;

  // Amount match (50% weight)
  if (Math.abs(statement.amount - candidate.amount) < 0.01) {
    confidence += 0.5;
  } else if (Math.abs(statement.amount - candidate.amount) < Math.abs(statement.amount) * 0.01) {
    confidence += 0.4;
  }

  // Date match (30% weight)
  const dateDiff = Math.abs(statement.date.getTime() - candidate.date.getTime()) / (1000 * 60 * 60 * 24);
  if (dateDiff === 0) {
    confidence += 0.3;
  } else if (dateDiff <= 1) {
    confidence += 0.25;
  } else if (dateDiff <= 3) {
    confidence += 0.15;
  }

  // Description match (20% weight)
  const descSimilarity = levenshteinSimilarity(
    statement.description.toLowerCase(),
    candidate.description.toLowerCase()
  );
  confidence += descSimilarity * 0.2;

  return Math.min(confidence, 1.0);
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
    const firstRow = matrix[0];
    if (firstRow) {
      firstRow[j] = j;
    }
  }
  for (let i = 1; i <= str2.length; i++) {
    const row = matrix[i];
    if (!row) continue;
    for (let j = 1; j <= str1.length; j++) {
      const prevRow = matrix[i - 1];
      if (!prevRow) continue;
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        row[j] = prevRow[j - 1] ?? 0;
      } else {
        row[j] = Math.min(
          (prevRow[j - 1] ?? 0) + 1,
          (row[j - 1] ?? 0) + 1,
          (prevRow[j] ?? 0) + 1
        );
      }
    }
  }
  const finalRow = matrix[str2.length];
  return finalRow?.[str1.length] ?? 0;
}
