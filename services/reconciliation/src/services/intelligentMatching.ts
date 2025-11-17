import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

const logger = createLogger('intelligent-matching');

export interface MatchSignals {
  amount: number; // 0-1 score
  date: number; // 0-1 score
  vendor: number; // 0-1 score (vendor name similarity)
  ocrConfidence: number; // 0-1 score (OCR confidence from document)
  description: number; // 0-1 score (description similarity)
}

export interface MatchCandidate {
  documentId?: string;
  ledgerEntryId?: string;
  bankTransactionId: string;
  confidenceScore: number;
  signals: MatchSignals;
  reason: string;
  matchType: 'auto' | 'suggest' | 'manual';
}

export interface MatchingThresholds {
  autoMatch: number; // Minimum confidence for auto-match
  suggestMatch: number; // Minimum confidence for suggestion
  signalWeights: {
    amount: number;
    date: number;
    vendor: number;
    ocrConfidence: number;
    description: number;
  };
}

export class IntelligentMatchingService {
  /**
   * Get or create matching thresholds for tenant
   */
  async getThresholds(tenantId: TenantId): Promise<MatchingThresholds> {
    const result = await db.query<{
      min_confidence_score: number;
      signal_weights: unknown;
    }>(
      `SELECT min_confidence_score, signal_weights
       FROM matching_thresholds
       WHERE tenant_id = $1 AND threshold_type = 'auto_match'`,
      [tenantId]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        autoMatch: parseFloat(row.min_confidence_score.toString()),
        suggestMatch: parseFloat(row.min_confidence_score.toString()) * 0.7, // 70% of auto-match threshold
        signalWeights: (row.signal_weights as MatchingThresholds['signalWeights']) || this.getDefaultWeights(),
      };
    }

    // Return default thresholds
    return {
      autoMatch: 0.85,
      suggestMatch: 0.60,
      signalWeights: this.getDefaultWeights(),
    };
  }

  /**
   * Update matching thresholds (learned from user feedback)
   */
  async updateThresholds(
    tenantId: TenantId,
    thresholds: Partial<MatchingThresholds>,
    learnedFromSamples: number
  ): Promise<void> {
    const existing = await this.getThresholds(tenantId);
    const updated: MatchingThresholds = {
      autoMatch: thresholds.autoMatch ?? existing.autoMatch,
      suggestMatch: thresholds.suggestMatch ?? existing.suggestMatch,
      signalWeights: {
        ...existing.signalWeights,
        ...(thresholds.signalWeights || {}),
      },
    };

    await db.query(
      `INSERT INTO matching_thresholds (
        id, tenant_id, threshold_type, min_confidence_score, signal_weights,
        learned_from_samples, last_updated_at, created_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW(), NOW())
      ON CONFLICT (tenant_id, threshold_type) DO UPDATE SET
        min_confidence_score = EXCLUDED.min_confidence_score,
        signal_weights = EXCLUDED.signal_weights,
        learned_from_samples = EXCLUDED.learned_from_samples,
        last_updated_at = NOW()`,
      [
        randomUUID(),
        tenantId,
        'auto_match',
        updated.autoMatch,
        JSON.stringify(updated.signalWeights),
        learnedFromSamples,
      ]
    );

    logger.info('Matching thresholds updated', { tenantId, thresholds: updated });
  }

  /**
   * Find intelligent matches for a bank transaction
   */
  async findMatches(
    tenantId: TenantId,
    bankTransactionId: string
  ): Promise<MatchCandidate[]> {
    // Get bank transaction
    const txResult = await db.query<{
      id: string;
      date: Date;
      amount: number;
      currency: string;
      description: string;
      category: string | null;
    }>(
      `SELECT id, date, amount, currency, description, category
       FROM bank_transactions
       WHERE id = $1 AND tenant_id = $2`,
      [bankTransactionId, tenantId]
    );

    if (txResult.rows.length === 0) {
      return [];
    }

    const transaction = txResult.rows[0];
    const thresholds = await this.getThresholds(tenantId);

    // Date range for matching (±7 days)
    const dateRangeStart = new Date(transaction.date);
    dateRangeStart.setDate(dateRangeStart.getDate() - 7);
    const dateRangeEnd = new Date(transaction.date);
    dateRangeEnd.setDate(dateRangeEnd.getDate() + 7);

    const candidates: MatchCandidate[] = [];

    // Match with documents
    const docsResult = await db.query<{
      id: string;
      extracted_data: unknown;
      confidence_score: number | null;
      document_type: string | null;
    }>(
      `SELECT id, extracted_data, confidence_score, document_type
       FROM documents
       WHERE tenant_id = $1
         AND status IN ('extracted', 'classified', 'posted')
         AND extracted_data->>'total' IS NOT NULL
         AND (extracted_data->>'date')::date BETWEEN $2 AND $3
         AND ABS((extracted_data->>'total')::numeric - $4) < 100
       ORDER BY ABS((extracted_data->>'date')::date - $5::date)`,
      [tenantId, dateRangeStart, dateRangeEnd, transaction.amount, transaction.date]
    );

    for (const doc of docsResult.rows) {
      const extractedData = (doc.extracted_data as Record<string, unknown>) || {};
      const signals = this.calculateSignals(transaction, extractedData, doc.confidence_score || 0.5);

      const confidenceScore = this.calculateConfidenceScore(signals, thresholds.signalWeights);
      const matchType = this.determineMatchType(confidenceScore, thresholds);

      if (matchType !== null) {
        candidates.push({
          documentId: doc.id,
          bankTransactionId: transaction.id,
          confidenceScore,
          signals,
          reason: this.generateReason(signals, matchType),
          matchType,
        });
      }
    }

    // Match with ledger entries
    const ledgerResult = await db.query<{
      id: string;
      amount: number;
      transaction_date: Date;
      description: string;
      account_code: string;
    }>(
      `SELECT id, amount, transaction_date, description, account_code
       FROM ledger_entries
       WHERE tenant_id = $1
         AND reconciled = false
         AND ABS(amount - $2) < 100
         AND transaction_date BETWEEN $3 AND $4
       ORDER BY ABS(transaction_date - $5::date)`,
      [tenantId, transaction.amount, dateRangeStart, dateRangeEnd, transaction.date]
    );

    for (const entry of ledgerResult.rows) {
      const signals = this.calculateSignalsForLedger(transaction, entry);
      const confidenceScore = this.calculateConfidenceScore(signals, thresholds.signalWeights);
      const matchType = this.determineMatchType(confidenceScore, thresholds);

      if (matchType !== null) {
        candidates.push({
          ledgerEntryId: entry.id,
          bankTransactionId: transaction.id,
          confidenceScore,
          signals,
          reason: this.generateReason(signals, matchType),
          matchType,
        });
      }
    }

    // Sort by confidence score
    return candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
  }

  /**
   * Calculate match signals for document
   */
  private calculateSignals(
    transaction: { amount: number; date: Date; description: string },
    extractedData: Record<string, unknown>,
    ocrConfidence: number
  ): MatchSignals {
    const docTotal = typeof extractedData.total === 'number'
      ? extractedData.total
      : parseFloat(String(extractedData.total || '0'));

    const docDate = extractedData.date
      ? (extractedData.date instanceof Date ? extractedData.date : new Date(String(extractedData.date)))
      : null;

    const docVendor = String(extractedData.vendor || '');
    const docDescription = String(extractedData.description || docVendor);

    // Amount signal (0-1)
    const amountDiff = Math.abs(docTotal - transaction.amount);
    const amountSignal = amountDiff < 0.01 ? 1.0 : Math.max(0, 1 - (amountDiff / Math.max(transaction.amount, 1)) * 10);

    // Date signal (0-1)
    let dateSignal = 0;
    if (docDate) {
      const daysDiff = Math.abs((docDate.getTime() - transaction.date.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff === 0) dateSignal = 1.0;
      else if (daysDiff <= 1) dateSignal = 0.9;
      else if (daysDiff <= 3) dateSignal = 0.7;
      else if (daysDiff <= 7) dateSignal = 0.5;
      else dateSignal = Math.max(0, 0.5 - (daysDiff - 7) * 0.05);
    }

    // Vendor signal (0-1) - string similarity
    const vendorSignal = this.calculateStringSimilarity(
      transaction.description.toLowerCase(),
      docVendor.toLowerCase()
    );

    // OCR confidence signal (0-1)
    const ocrConfidenceSignal = ocrConfidence;

    // Description signal (0-1)
    const descriptionSignal = this.calculateStringSimilarity(
      transaction.description.toLowerCase(),
      docDescription.toLowerCase()
    );

    return {
      amount: amountSignal,
      date: dateSignal,
      vendor: vendorSignal,
      ocrConfidence: ocrConfidenceSignal,
      description: descriptionSignal,
    };
  }

  /**
   * Calculate match signals for ledger entry
   */
  private calculateSignalsForLedger(
    transaction: { amount: number; date: Date; description: string },
    entry: { amount: number; transaction_date: Date; description: string }
  ): MatchSignals {
    // Amount signal
    const amountDiff = Math.abs(entry.amount - transaction.amount);
    const amountSignal = amountDiff < 0.01 ? 1.0 : Math.max(0, 1 - (amountDiff / Math.max(transaction.amount, 1)) * 10);

    // Date signal
    const daysDiff = Math.abs((entry.transaction_date.getTime() - transaction.date.getTime()) / (1000 * 60 * 60 * 24));
    let dateSignal = 0;
    if (daysDiff === 0) dateSignal = 1.0;
    else if (daysDiff <= 1) dateSignal = 0.9;
    else if (daysDiff <= 3) dateSignal = 0.7;
    else if (daysDiff <= 7) dateSignal = 0.5;
    else dateSignal = Math.max(0, 0.5 - (daysDiff - 7) * 0.05);

    // Description signal
    const descriptionSignal = this.calculateStringSimilarity(
      transaction.description.toLowerCase(),
      entry.description.toLowerCase()
    );

    return {
      amount: amountSignal,
      date: dateSignal,
      vendor: 0, // Not applicable for ledger entries
      ocrConfidence: 1.0, // Ledger entries are already structured
      description: descriptionSignal,
    };
  }

  /**
   * Calculate weighted confidence score
   */
  private calculateConfidenceScore(
    signals: MatchSignals,
    weights: MatchingThresholds['signalWeights']
  ): number {
    const totalWeight = weights.amount + weights.date + weights.vendor + weights.ocrConfidence + weights.description;
    
    return (
      signals.amount * weights.amount +
      signals.date * weights.date +
      signals.vendor * weights.vendor +
      signals.ocrConfidence * weights.ocrConfidence +
      signals.description * weights.description
    ) / totalWeight;
  }

  /**
   * Determine match type based on confidence
   */
  private determineMatchType(
    confidenceScore: number,
    thresholds: MatchingThresholds
  ): 'auto' | 'suggest' | 'manual' | null {
    if (confidenceScore >= thresholds.autoMatch) {
      return 'auto';
    } else if (confidenceScore >= thresholds.suggestMatch) {
      return 'suggest';
    } else if (confidenceScore >= 0.3) {
      return 'manual';
    }
    return null;
  }

  /**
   * Generate human-readable reason
   */
  private generateReason(signals: MatchSignals, matchType: 'auto' | 'suggest' | 'manual'): string {
    const reasons: string[] = [];

    if (signals.amount >= 0.95) reasons.push('exact amount match');
    else if (signals.amount >= 0.8) reasons.push('near amount match');

    if (signals.date >= 0.9) reasons.push('same date');
    else if (signals.date >= 0.7) reasons.push('date within 3 days');

    if (signals.vendor >= 0.8) reasons.push('vendor match');
    if (signals.description >= 0.7) reasons.push('description similarity');

    if (matchType === 'auto') {
      return `Auto-match: ${reasons.join(', ')}`;
    } else if (matchType === 'suggest') {
      return `Suggested match: ${reasons.join(', ')}`;
    } else {
      return `Possible match: ${reasons.join(', ')}`;
    }
  }

  /**
   * Calculate string similarity (Jaro-Winkler-like)
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1.0;

    // Simple word overlap
    const words1 = new Set(str1.split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(str2.split(/\s+/).filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Get default signal weights
   */
  private getDefaultWeights(): MatchingThresholds['signalWeights'] {
    return {
      amount: 0.35,
      date: 0.25,
      vendor: 0.15,
      ocrConfidence: 0.10,
      description: 0.15,
    };
  }

  /**
   * Record reconciliation event
   */
  async recordEvent(
    tenantId: TenantId,
    event: {
      bankTransactionId?: string;
      documentId?: string;
      ledgerEntryId?: string;
      eventType: 'match' | 'unmatch' | 'auto_match' | 'manual_match' | 'split' | 'merge' | 'exception_created' | 'exception_resolved';
      reasonCode: string;
      reasonDescription?: string;
      confidenceScore?: number;
      matchSignals?: MatchSignals;
      performedBy?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<string> {
    const eventId = randomUUID();

    await db.query(
      `INSERT INTO reconciliation_events (
        id, tenant_id, bank_transaction_id, document_id, ledger_entry_id,
        event_type, reason_code, reason_description, confidence_score,
        match_signals, performed_by, performed_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW(), $12::jsonb)`,
      [
        eventId,
        tenantId,
        event.bankTransactionId || null,
        event.documentId || null,
        event.ledgerEntryId || null,
        event.eventType,
        event.reasonCode,
        event.reasonDescription || null,
        event.confidenceScore || null,
        JSON.stringify(event.matchSignals || {}),
        event.performedBy || null,
        JSON.stringify(event.metadata || {}),
      ]
    );

    logger.info('Reconciliation event recorded', { eventId, eventType: event.eventType });

    return eventId;
  }
}

export const intelligentMatchingService = new IntelligentMatchingService();
