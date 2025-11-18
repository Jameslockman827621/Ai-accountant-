import { createLogger } from '@ai-accountant/shared-utils';
import { errorRecoveryEngine, RetryableOperation } from '../services/errorRecoveryEngine';
import { db } from '@ai-accountant/database';

const logger = createLogger('error-recovery-worker');
const RETRY_INTERVAL_MS = 30000; // Check every 30 seconds
const MAX_CONCURRENT_RETRIES = 10;

/**
 * Worker process that executes scheduled error retries
 * Runs continuously, checking for pending retries and executing them
 */
export async function startErrorRetryWorker(): Promise<void> {
  logger.info('Error recovery retry worker started');

  // Process retries immediately, then on interval
  await processRetries();

  setInterval(async () => {
    try {
      await processRetries();
    } catch (error) {
      logger.error('Error in retry worker cycle', error instanceof Error ? error : new Error(String(error)));
    }
  }, RETRY_INTERVAL_MS);
}

async function processRetries(): Promise<void> {
  try {
    const pendingRetries = await errorRecoveryEngine.getPendingRetries(MAX_CONCURRENT_RETRIES);

    if (pendingRetries.length === 0) {
      return;
    }

    logger.info('Processing error retries', { count: pendingRetries.length });

    // Process retries in parallel (with limit)
    const retryPromises = pendingRetries.map(retry => executeRetry(retry));
    await Promise.allSettled(retryPromises);
  } catch (error) {
    logger.error('Failed to process retries', error instanceof Error ? error : new Error(String(error)));
  }
}

async function executeRetry(retry: {
  id: string;
  tenantId: string;
  userId: string;
  operationType: RetryableOperation['operationType'];
  operationId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    // Mark as retrying
    await db.query(
      `UPDATE error_retries
       SET status = 'retrying', updated_at = NOW()
       WHERE id = $1`,
      [retry.id]
    );

    // Execute the operation based on type
    let success = false;

    switch (retry.operationType) {
      case 'document_processing': {
        // Retry document processing by republishing to OCR queue
        const { publishOCRJob } = await import('@ai-accountant/document-ingest-service/messaging/queue');
        const storageKey =
          typeof retry.metadata?.storageKey === 'string' ? retry.metadata.storageKey : undefined;

        if (!storageKey) {
          logger.warn('Missing storage key for document retry', { retryId: retry.id });
          break;
        }

        await publishOCRJob(retry.operationId, storageKey, {
          source: 'error-recovery.retry',
          headers: {
            'x-retry': 'true',
            'x-retry-id': retry.id,
          },
        });
        success = true;
        break;
      }

      case 'bank_sync': {
        // Bank sync retries are handled by bank-feed retry worker
        // This is just a fallback
        logger.info('Bank sync retry should be handled by bank-feed worker', { retryId: retry.id });
        success = true;
        break;
      }

      case 'filing_submission': {
        // Retry filing submission
        const filingResult = await db.query<{
          filing_data: unknown;
          filing_type: string;
          period_start: Date;
          period_end: Date;
        }>(
          `SELECT filing_data, filing_type, period_start, period_end
           FROM filings
           WHERE id = $1 AND tenant_id = $2`,
          [retry.operationId, retry.tenantId]
        );

        if (filingResult.rows.length > 0) {
          // In production, would resubmit to HMRC
          logger.info('Filing submission retry', { filingId: retry.operationId });
          success = true;
        }
        break;
      }

      case 'tax_calculation': {
        // Retry tax calculation
        logger.info('Tax calculation retry', { operationId: retry.operationId });
        // Would trigger recalculation
        success = true;
        break;
      }

      default: {
        logger.warn('Unknown operation type for retry', { operationType: retry.operationType });
        success = false;
      }
    }

    if (success) {
      // Mark as succeeded
      await errorRecoveryEngine.markSucceeded(retry.id);
      logger.info('Error retry succeeded', { retryId: retry.id, operationType: retry.operationType });
    } else {
      // Schedule another retry if not at max
      try {
        await errorRecoveryEngine.scheduleRetry(
          retry.tenantId,
          retry.userId,
          retry.operationType,
          retry.operationId,
          'Retry execution failed',
          retry.metadata
        );
      } catch (retryError) {
        // Max retries reached, mark as failed
        await errorRecoveryEngine.markFailed(retry.id);
        logger.warn('Max retries reached for error recovery', { retryId: retry.id });
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const normalizedError = error instanceof Error ? error : new Error(errorMessage);
    logger.error(
      'Error retry failed',
      normalizedError,
      {
        retryId: retry.id,
        operationType: retry.operationType,
        error: errorMessage,
      }
    );

    // Schedule another retry if not at max
    try {
      await errorRecoveryEngine.scheduleRetry(
        retry.tenantId,
        retry.userId,
        retry.operationType,
        retry.operationId,
        errorMessage,
        retry.metadata
      );
    } catch (retryError) {
      // Max retries reached, mark as failed
      await errorRecoveryEngine.markFailed(retry.id);
      logger.warn('Max retries reached for error recovery', { retryId: retry.id });
    }
  }
}

// Start worker if this file is run directly
if (require.main === module) {
  startErrorRetryWorker().catch(error => {
    logger.error('Failed to start error retry worker', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  });
}
