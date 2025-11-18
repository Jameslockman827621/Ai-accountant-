import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('enhanced-reconciliation');

export interface MatchingRule {
  field: string;
  tolerance?: number;
  toleranceType?: 'absolute' | 'percentage';
  weight: number;
}

export interface MatchCandidate {
  bankTransactionId: string;
  documentId?: string;
  ledgerEntryId?: string;
  matchScore: number;
  matchType: 'exact' | 'partial' | 'fuzzy';
  amountDifference?: number;
  dateDifference?: number;
}

export interface ReconciliationResult {
  matchId: string;
  matchType: 'exact' | 'partial' | 'fuzzy' | 'manual';
  matchConfidence: number;
  matchScore: number;
  bankTransactionId: string;
  documentId?: string;
  ledgerEntryId?: string;
  amountDifference?: number;
  dateDifference?: number;
  currency?: string;
  exchangeRate?: number;
  status: 'matched' | 'unmatched' | 'exception';
}

export class EnhancedReconciliationService {
  /**
   * Match bank transaction to documents/ledger entries
   */
  async matchTransaction(
    tenantId: TenantId,
    bankTransactionId: string,
    rules?: MatchingRule[]
  ): Promise<ReconciliationResult | null> {
    try {
      // Get bank transaction
      const bankTx = await this.getBankTransaction(bankTransactionId);
      if (!bankTx) {
        throw new Error('Bank transaction not found');
      }

      // Get candidates
      const candidates = await this.findCandidates(tenantId, bankTx, rules);

      if (candidates.length === 0) {
        return {
          matchId: randomUUID(),
          matchType: 'fuzzy',
          matchConfidence: 0,
          matchScore: 0,
          bankTransactionId,
          status: 'unmatched',
        };
      }

      // Sort by match score
      candidates.sort((a, b) => b.matchScore - a.matchScore);
      const bestMatch = candidates[0];
      if (!bestMatch) {
        return {
          matchId: randomUUID(),
          matchType: 'fuzzy',
          matchConfidence: 0,
          matchScore: 0,
          bankTransactionId,
          status: 'unmatched',
        };
      }

      // Create match record
      const matchId = randomUUID();
      const matchRecord: ReconciliationResult = {
        matchId,
        matchType: bestMatch.matchType,
        matchConfidence: bestMatch.matchScore,
        matchScore: bestMatch.matchScore,
        bankTransactionId,
        currency: bankTx.currency,
        status: bestMatch.matchScore >= 0.85 ? 'matched' : 'exception',
      };

      if (bestMatch.documentId) {
        matchRecord.documentId = bestMatch.documentId;
      }
      if (bestMatch.ledgerEntryId) {
        matchRecord.ledgerEntryId = bestMatch.ledgerEntryId;
      }
      if (bestMatch.amountDifference !== undefined) {
        matchRecord.amountDifference = bestMatch.amountDifference;
      }
      if (bestMatch.dateDifference !== undefined) {
        matchRecord.dateDifference = bestMatch.dateDifference;
      }

      await this.createMatchRecord(tenantId, matchRecord);

      logger.info('Transaction matched', {
        tenantId,
        bankTransactionId,
        matchId,
        matchScore: bestMatch.matchScore,
      });

      return matchRecord;
    } catch (error) {
      logger.error('Matching failed', {
        bankTransactionId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Find matching candidates
   */
  private async findCandidates(
    tenantId: TenantId,
    bankTx: {
      id: string;
      amount: number;
      date: Date;
      description: string;
      currency: string;
    },
    rules?: MatchingRule[]
  ): Promise<MatchCandidate[]> {
    const candidates: MatchCandidate[] = [];

    // Match against documents
    const documentCandidates = await this.matchDocuments(tenantId, bankTx, rules);
    candidates.push(...documentCandidates);

    // Match against ledger entries
    const ledgerCandidates = await this.matchLedgerEntries(tenantId, bankTx, rules);
    candidates.push(...ledgerCandidates);

    return candidates;
  }

  /**
   * Match against documents
   */
  private async matchDocuments(
    tenantId: TenantId,
    bankTx: {
      id: string;
      amount: number;
      date: Date;
      description: string;
      currency: string;
    },
    rules?: MatchingRule[]
  ): Promise<MatchCandidate[]> {
    const candidates: MatchCandidate[] = [];

    // Get documents with similar amounts and dates
    const dateTolerance = 7; // 7 days
    const amountTolerance = 0.02; // 2% or $2

    const result = await db.query<{
      id: string;
      extracted_data: unknown;
      document_type: string;
      total_amount: number;
      date: Date;
    }>(
      `SELECT d.id, d.extracted_data, d.document_type,
              (d.extracted_data->>'total')::numeric as total_amount,
              (d.extracted_data->>'date')::date as date
       FROM documents d
       JOIN classification_results cr ON cr.document_id = d.id
       WHERE d.tenant_id = $1
         AND d.status = 'classified'
         AND ABS((d.extracted_data->>'total')::numeric - $2) <= GREATEST($2 * $3, $4)
         AND ABS(EXTRACT(EPOCH FROM ((d.extracted_data->>'date')::date - $5)) / 86400) <= $6
         AND cr.reconciliation_status IS NULL
       LIMIT 20`,
      [
        tenantId,
        Math.abs(bankTx.amount),
        amountTolerance,
        2.0, // Minimum $2 tolerance
        bankTx.date,
        dateTolerance,
      ]
    );

    for (const doc of result.rows) {
      const matchScore = this.calculateMatchScore(
        {
          amount: Math.abs(bankTx.amount),
          date: bankTx.date,
          description: bankTx.description,
        },
        {
          amount: doc.total_amount,
          date: doc.date,
          description: doc.document_type,
        },
        rules
      );

      if (matchScore > 0.5) {
        const candidate: MatchCandidate = {
          bankTransactionId: bankTx.id,
          documentId: doc.id,
          matchScore,
          matchType: matchScore >= 0.9 ? 'exact' : matchScore >= 0.75 ? 'partial' : 'fuzzy',
          amountDifference: Math.abs(bankTx.amount) - doc.total_amount,
          dateDifference: Math.floor(
            (bankTx.date.getTime() - doc.date.getTime()) / (1000 * 60 * 60 * 24)
          ),
        };
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  /**
   * Match against ledger entries
   */
  private async matchLedgerEntries(
    tenantId: TenantId,
    bankTx: {
      id: string;
      amount: number;
      date: Date;
      description: string;
    },
    rules?: MatchingRule[]
  ): Promise<MatchCandidate[]> {
    const candidates: MatchCandidate[] = [];

    // Similar logic to document matching
    const result = await db.query<{
      id: string;
      amount: number;
      transaction_date: Date;
      description: string;
    }>(
      `SELECT id, amount, transaction_date, description
       FROM ledger_entries
       WHERE tenant_id = $1
         AND ABS(amount - $2) <= GREATEST($2 * 0.02, 2.0)
         AND ABS(EXTRACT(EPOCH FROM (transaction_date - $3)) / 86400) <= 7
         AND reconciled = false
       LIMIT 20`,
      [tenantId, Math.abs(bankTx.amount), bankTx.date]
    );

    for (const entry of result.rows) {
      const matchScore = this.calculateMatchScore(
        {
          amount: Math.abs(bankTx.amount),
          date: bankTx.date,
          description: bankTx.description,
        },
        {
          amount: entry.amount,
          date: entry.transaction_date,
          description: entry.description,
        },
        rules
      );

      if (matchScore > 0.5) {
        const candidate: MatchCandidate = {
          bankTransactionId: bankTx.id,
          ledgerEntryId: entry.id,
          matchScore,
          matchType: matchScore >= 0.9 ? 'exact' : matchScore >= 0.75 ? 'partial' : 'fuzzy',
          amountDifference: Math.abs(bankTx.amount) - entry.amount,
          dateDifference: Math.floor(
            (bankTx.date.getTime() - entry.transaction_date.getTime()) / (1000 * 60 * 60 * 24)
          ),
        };
        candidates.push(candidate);
      }
    }

    return candidates;
  }

  /**
   * Calculate match score
   */
  private calculateMatchScore(
    bankTx: { amount: number; date: Date; description: string },
    candidate: { amount: number; date: Date; description: string },
    rules?: MatchingRule[]
  ): number {
    let score = 0;
    let totalWeight = 0;

    const defaultRules: MatchingRule[] = [
      { field: 'amount', tolerance: 0.02, toleranceType: 'percentage', weight: 0.5 },
      { field: 'date', tolerance: 7, toleranceType: 'absolute', weight: 0.3 },
      { field: 'description', weight: 0.2 },
    ];

    const activeRules = rules || defaultRules;

    for (const rule of activeRules) {
      let fieldScore = 0;

      switch (rule.field) {
        case 'amount':
          const amountDiff = Math.abs(bankTx.amount - candidate.amount);
          const tolerance = rule.toleranceType === 'percentage'
            ? bankTx.amount * (rule.tolerance || 0)
            : (rule.tolerance || 0);
          fieldScore = amountDiff <= tolerance ? 1 - (amountDiff / tolerance) : 0;
          break;

        case 'date':
          const dateDiff = Math.abs(
            (bankTx.date.getTime() - candidate.date.getTime()) / (1000 * 60 * 60 * 24)
          );
          const dateTolerance = rule.tolerance || 7;
          fieldScore = dateDiff <= dateTolerance ? 1 - (dateDiff / dateTolerance) : 0;
          break;

        case 'description':
          // Simple string similarity
          const desc1 = bankTx.description.toLowerCase();
          const desc2 = candidate.description.toLowerCase();
          fieldScore = this.stringSimilarity(desc1, desc2);
          break;
      }

      score += fieldScore * rule.weight;
      totalWeight += rule.weight;
    }

    return totalWeight > 0 ? score / totalWeight : 0;
  }

  /**
   * String similarity (simple Jaccard)
   */
  private stringSimilarity(str1: string, str2: string): number {
    const words1 = new Set(str1.split(/\s+/));
    const words2 = new Set(str2.split(/\s+/));

    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Get bank transaction
   */
  private async getBankTransaction(id: string): Promise<{
    id: string;
    amount: number;
    date: Date;
    description: string;
    currency: string;
  } | null> {
    const result = await db.query<{
      id: string;
      amount: number;
      date: Date;
      description: string;
      currency: string;
    }>(
      'SELECT id, amount, date, description, currency FROM bank_transactions WHERE id = $1',
      [id]
    );

    const row = result.rows[0];
    return row ?? null;
  }

  /**
   * Create match record
   */
  private async createMatchRecord(tenantId: TenantId, result: ReconciliationResult): Promise<void> {
    await db.query(
      `INSERT INTO reconciliation_matches (
        id, tenant_id, match_type, match_confidence, match_score,
        bank_transaction_id, document_id, ledger_entry_id,
        bank_amount, document_amount, amount_difference,
        bank_date, document_date, date_difference_days,
        currency, status, auto_matched, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())`,
      [
        result.matchId,
        tenantId,
        result.matchType,
        result.matchConfidence,
        result.matchScore,
        result.bankTransactionId,
        result.documentId,
        result.ledgerEntryId,
        result.amountDifference ? Math.abs(result.amountDifference) : null,
        result.documentId ? null : null, // Would get from document
        result.amountDifference,
        null, // Would get from bank transaction
        null, // Would get from document
        result.dateDifference,
        result.currency,
        result.status,
        result.matchType !== 'manual',
      ]
    );
  }

  /**
   * Reconcile all unmatched transactions
   */
  async reconcileUnmatched(tenantId: TenantId): Promise<{
    matched: number;
    unmatched: number;
    exceptions: number;
  }> {
    const result = await db.query<{ id: string }>(
      `SELECT id FROM bank_transactions
       WHERE tenant_id = $1
         AND reconciled = false
         AND date >= NOW() - INTERVAL '30 days'
       LIMIT 1000`,
      [tenantId]
    );

    let matched = 0;
    let unmatched = 0;
    let exceptions = 0;

    for (const tx of result.rows) {
      try {
        const matchResult = await this.matchTransaction(tenantId, tx.id);
        if (matchResult) {
          if (matchResult.status === 'matched') {
            matched++;
          } else if (matchResult.status === 'exception') {
            exceptions++;
          } else {
            unmatched++;
          }
        } else {
          unmatched++;
        }
      } catch (error) {
        logger.error('Reconciliation failed for transaction', {
          transactionId: tx.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        unmatched++;
      }
    }

    return { matched, unmatched, exceptions };
  }
}

export const enhancedReconciliationService = new EnhancedReconciliationService();
