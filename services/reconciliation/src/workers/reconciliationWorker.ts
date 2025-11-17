import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { intelligentMatchingService } from '../services/intelligentMatching';
import { reconciliationExceptionService } from '../services/reconciliationExceptions';

const logger = createLogger('reconciliation-worker');

export interface ReconciliationJob {
  tenantId: TenantId;
  bankTransactionId: string;
  priority: 'high' | 'medium' | 'low';
}

export class ReconciliationWorker {
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private batchSize = 50;

  /**
   * Start background reconciliation worker
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('Reconciliation worker already running');
      return;
    }

    this.isRunning = true;
    // Process every 30 seconds
    this.processingInterval = setInterval(() => {
      void this.processBatch();
    }, 30000);

    // Process immediately
    void this.processBatch();

    logger.info('Reconciliation worker started');
  }

  /**
   * Stop worker
   */
  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.isRunning = false;
    logger.info('Reconciliation worker stopped');
  }

  /**
   * Process batch of unreconciled transactions
   */
  private async processBatch(): Promise<void> {
    try {
      // Get unreconciled transactions, prioritizing by age and amount
      const transactions = await this.getUnreconciledTransactions(this.batchSize);

      logger.info('Processing reconciliation batch', { count: transactions.length });

      for (const tx of transactions) {
        try {
          await this.processTransaction(tx.tenantId, tx.bankTransactionId);
        } catch (error) {
          logger.error('Failed to process transaction', {
            tenantId: tx.tenantId,
            bankTransactionId: tx.bankTransactionId,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    } catch (error) {
      logger.error('Failed to process reconciliation batch', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get unreconciled transactions with priority
   */
  private async getUnreconciledTransactions(limit: number): Promise<Array<{ tenantId: TenantId; bankTransactionId: string }>> {
    const result = await db.query<{
      tenant_id: string;
      id: string;
      date: Date;
      amount: number;
    }>(
      `SELECT tenant_id, id, date, amount
       FROM bank_transactions
       WHERE reconciled = false
         AND date >= NOW() - INTERVAL '90 days' -- Only process recent transactions
       ORDER BY
         CASE WHEN ABS(amount) > 10000 THEN 1 ELSE 2 END, -- High amount first
         date ASC -- Oldest first
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => ({
      tenantId: row.tenant_id as TenantId,
      bankTransactionId: row.id,
    }));
  }

  /**
   * Process single transaction
   */
  private async processTransaction(tenantId: TenantId, bankTransactionId: string): Promise<void> {
    // Find matches
    const matches = await intelligentMatchingService.findMatches(tenantId, bankTransactionId);

    if (matches.length === 0) {
      // No matches found - create exception if transaction is old enough
      const txResult = await db.query<{ date: Date }>(
        `SELECT date FROM bank_transactions WHERE id = $1`,
        [bankTransactionId]
      );

      if (txResult.rows.length > 0) {
        const daysOld = (Date.now() - txResult.rows[0].date.getTime()) / (1000 * 60 * 60 * 24);
        if (daysOld > 7) {
          // Transaction is more than 7 days old with no match
          await reconciliationExceptionService.createException(tenantId, {
            exceptionType: 'unmatched',
            bankTransactionId,
            description: `Transaction unmatched for ${Math.floor(daysOld)} days`,
            severity: daysOld > 30 ? 'high' : 'medium',
          });
        }
      }
      return;
    }

    // Get best match
    const bestMatch = matches[0];

    // Auto-match if confidence is high enough
    if (bestMatch.matchType === 'auto' && bestMatch.confidenceScore >= 0.85) {
      await this.autoMatch(tenantId, bankTransactionId, bestMatch);
    } else {
      // Mark as suggested match (will be shown in UI)
      await this.markAsSuggested(tenantId, bankTransactionId, bestMatch);
    }
  }

  /**
   * Auto-match transaction
   */
  private async autoMatch(
    tenantId: TenantId,
    bankTransactionId: string,
    match: { documentId?: string; ledgerEntryId?: string; confidenceScore: number; signals: any }
  ): Promise<void> {
    await db.transaction(async (client) => {
      // Update bank transaction
      await client.query(
        `UPDATE bank_transactions
         SET reconciled = true,
             reconciled_with_document = $1,
             reconciled_with_ledger = $2,
             updated_at = NOW()
         WHERE id = $3 AND tenant_id = $4`,
        [match.documentId || null, match.ledgerEntryId || null, bankTransactionId, tenantId]
      );

      // Update document if provided
      if (match.documentId) {
        await client.query(
          `UPDATE documents
           SET status = 'posted', updated_at = NOW()
           WHERE id = $1 AND tenant_id = $2`,
          [match.documentId, tenantId]
        );
      }

      // Update ledger entry if provided
      if (match.ledgerEntryId) {
        await client.query(
          `UPDATE ledger_entries
           SET reconciled = true, reconciled_with = $1, updated_at = NOW()
           WHERE id = $2 AND tenant_id = $3`,
          [bankTransactionId, match.ledgerEntryId, tenantId]
        );
      }
    });

    // Record event
    await intelligentMatchingService.recordEvent(tenantId, {
      bankTransactionId,
      documentId: match.documentId,
      ledgerEntryId: match.ledgerEntryId,
      eventType: 'auto_match',
      reasonCode: 'high_confidence_auto_match',
      reasonDescription: `Auto-matched with confidence ${(match.confidenceScore * 100).toFixed(1)}%`,
      confidenceScore: match.confidenceScore,
      matchSignals: match.signals,
      metadata: {
        automated: true,
        worker: 'reconciliation-worker',
      },
    });

    logger.info('Transaction auto-matched', {
      tenantId,
      bankTransactionId,
      confidenceScore: match.confidenceScore,
    });
  }

  /**
   * Mark as suggested match
   */
  private async markAsSuggested(
    tenantId: TenantId,
    bankTransactionId: string,
    match: { documentId?: string; ledgerEntryId?: string; confidenceScore: number; signals: any }
  ): Promise<void> {
    // Store suggested match (would use a suggestions table or metadata)
    await db.query(
      `UPDATE bank_transactions
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
         'suggested_match', jsonb_build_object(
           'document_id', $1,
           'ledger_entry_id', $2,
           'confidence_score', $3,
           'signals', $4::jsonb
         )
       )
       WHERE id = $5 AND tenant_id = $6`,
      [
        match.documentId || null,
        match.ledgerEntryId || null,
        match.confidenceScore,
        JSON.stringify(match.signals),
        bankTransactionId,
        tenantId,
      ]
    );

    logger.info('Suggested match stored', {
      tenantId,
      bankTransactionId,
      confidenceScore: match.confidenceScore,
    });
  }
}

export const reconciliationWorker = new ReconciliationWorker();
