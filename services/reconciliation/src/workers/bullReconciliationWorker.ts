// Conditional import for bullmq - may not be installed
// Using dynamic require to handle optional dependency
import type { Queue as BullMQQueue, Worker as BullMQWorker, Job as BullMQJob } from 'bullmq';

let Queue: typeof BullMQQueue | null = null;
let Worker: typeof BullMQWorker | null = null;
let Job: typeof BullMQJob | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bullmq = require('bullmq');
  Queue = bullmq.Queue;
  Worker = bullmq.Worker;
  Job = bullmq.Job;
} catch {
  // bullmq not installed - will throw at runtime if used
  // This is handled by the conditional import in index.ts
}

import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { intelligentMatchingService } from '../services/intelligentMatching';
import { reconciliationExceptionService } from '../services/reconciliationExceptions';
import { db } from '@ai-accountant/database';

const logger = createLogger('bull-reconciliation-worker');

// Redis connection configuration
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null, // Required for BullMQ
};

// Create queue (only if Queue is available)
export const reconciliationQueue: BullMQQueue<ReconciliationJobData> | null = Queue
  ? new Queue('reconciliation', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      age: 3600, // Keep completed jobs for 1 hour
      count: 1000, // Keep last 1000 completed jobs
    },
    removeOnFail: {
      age: 86400, // Keep failed jobs for 24 hours
    },
  },
})
  : null;

interface ReconciliationJobData {
  tenantId: TenantId;
  bankTransactionId: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * Process a single reconciliation job
 */
async function processReconciliationJob(
  job: BullMQJob<ReconciliationJobData>
): Promise<void> {
  const { tenantId, bankTransactionId } = job.data;

  logger.info('Processing reconciliation job', {
    jobId: job.id,
    tenantId,
    bankTransactionId,
    attempt: job.attemptsMade + 1,
  });

  try {
    // Find matches
    const matches = await intelligentMatchingService.findMatches(tenantId, bankTransactionId);

    if (matches.length === 0) {
      // No matches found - create exception if transaction is old enough
      const txResult = await db.query<{ date: Date }>(
        `SELECT date FROM bank_transactions WHERE id = $1`,
        [bankTransactionId]
      );

      const txRow = txResult.rows[0];
      if (txRow) {
        const daysOld = (Date.now() - txRow.date.getTime()) / (1000 * 60 * 60 * 24);
        if (daysOld > 7) {
          await reconciliationExceptionService.createException(tenantId, {
            exceptionType: 'unmatched',
            bankTransactionId,
            description: `Transaction unmatched for ${Math.floor(daysOld)} days`,
            severity: daysOld > 30 ? 'high' : 'medium',
          });
        }
      }

      logger.info('No matches found', { tenantId, bankTransactionId });
      return;
    }

    // Get best match
    const bestMatch = matches[0];
    if (!bestMatch) {
      logger.info('No valid match found', { tenantId, bankTransactionId });
      return;
    }

    // Auto-match if confidence is high enough
    if (bestMatch.matchType === 'auto' && bestMatch.confidenceScore >= 0.85) {
      await autoMatch(tenantId, bankTransactionId, bestMatch);
    } else {
      // Mark as suggested match
      await markAsSuggested(tenantId, bankTransactionId, bestMatch);
    }

    logger.info('Reconciliation job completed', {
      jobId: job.id,
      tenantId,
      bankTransactionId,
      matchType: bestMatch.matchType,
      confidenceScore: bestMatch.confidenceScore,
    });
  } catch (error) {
    logger.error('Reconciliation job failed', {
      jobId: job.id,
      tenantId,
      bankTransactionId,
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw error; // Re-throw to trigger retry
  }
}

/**
 * Auto-match transaction
 */
async function autoMatch(
  tenantId: TenantId,
  bankTransactionId: string,
  match: { documentId?: string; ledgerEntryId?: string; confidenceScore: number; signals: unknown }
): Promise<void> {
  await db.transaction(async (client) => {
    await client.query(
      `UPDATE bank_transactions
       SET reconciled = true,
           reconciled_with_document = $1,
           reconciled_with_ledger = $2,
           updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4`,
      [match.documentId || null, match.ledgerEntryId || null, bankTransactionId, tenantId]
    );

    if (match.documentId) {
      await client.query(
        `UPDATE documents
         SET status = 'posted', updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [match.documentId, tenantId]
      );
    }

    if (match.ledgerEntryId) {
      await client.query(
        `UPDATE ledger_entries
         SET reconciled = true, reconciled_with = $1, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3`,
        [bankTransactionId, match.ledgerEntryId, tenantId]
      );
    }
  });

  await intelligentMatchingService.recordEvent(tenantId, {
    bankTransactionId,
    documentId: match.documentId,
    ledgerEntryId: match.ledgerEntryId,
    eventType: 'auto_match',
    reasonCode: 'high_confidence_auto_match',
    reasonDescription: `Auto-matched with confidence ${(match.confidenceScore * 100).toFixed(1)}%`,
    confidenceScore: match.confidenceScore,
      // matchSignals type will be handled by the service
    metadata: {
      automated: true,
      worker: 'bull-reconciliation-worker',
    },
  });
}

/**
 * Mark as suggested match
 */
async function markAsSuggested(
  tenantId: TenantId,
  bankTransactionId: string,
  match: { documentId?: string; ledgerEntryId?: string; confidenceScore: number; signals: unknown }
): Promise<void> {
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
}

/**
 * Create BullMQ worker
 */
export function createReconciliationWorker(): BullMQWorker<ReconciliationJobData> {
  if (!Worker) {
    throw new Error('BullMQ Worker is not available. Please install bullmq package.');
  }
  const worker = new Worker<ReconciliationJobData>(
    'reconciliation',
    async (job: BullMQJob<ReconciliationJobData>) => {
      await processReconciliationJob(job);
    },
    {
      connection: redisConnection,
      concurrency: parseInt(process.env.RECONCILIATION_WORKER_CONCURRENCY || '10', 10),
      limiter: {
        max: 100, // Max 100 jobs per interval
        duration: 1000, // Per second
      },
    }
  );

  worker.on('completed', (job: BullMQJob<ReconciliationJobData> | undefined) => {
    logger.info('Job completed', {
      jobId: job?.id,
      tenantId: job?.data?.tenantId,
      duration:
        job && job.finishedOn && job.processedOn
          ? job.finishedOn - job.processedOn
          : undefined,
    });
  });

  worker.on('failed', (job: BullMQJob<ReconciliationJobData> | undefined, err: Error) => {
    logger.error('Job failed', {
      jobId: job?.id,
      tenantId: job?.data?.tenantId,
      error: err instanceof Error ? err : new Error(String(err)),
      attempts: job?.attemptsMade,
    });
  });

  worker.on('error', (err: Error) => {
    logger.error('Worker error', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
  });

  logger.info('BullMQ reconciliation worker created', {
    concurrency: parseInt(process.env.RECONCILIATION_WORKER_CONCURRENCY || '10', 10),
  });

  return worker;
}

/**
 * Add reconciliation job to queue
 */
export async function addReconciliationJob(
  tenantId: TenantId,
  bankTransactionId: string,
  priority: 'high' | 'medium' | 'low' = 'medium'
): Promise<string> {
  if (!reconciliationQueue) {
    throw new Error('Reconciliation queue is not available. Please install bullmq package.');
  }
  const job = await reconciliationQueue.add(
    'reconcile-transaction',
    {
      tenantId,
      bankTransactionId,
      priority,
    },
    {
      priority: priority === 'high' ? 1 : priority === 'medium' ? 5 : 10,
      jobId: `reconcile-${tenantId}-${bankTransactionId}`,
    }
  );

  logger.info('Reconciliation job added to queue', {
    jobId: job.id,
    tenantId,
    bankTransactionId,
    priority,
  });

  return job.id ?? '';
}

/**
 * Schedule batch reconciliation jobs
 */
export async function scheduleBatchReconciliation(
  tenantId: TenantId,
  options?: { limit?: number; priority?: 'high' | 'medium' | 'low' }
): Promise<number> {
  const limit = options?.limit || 100;
  const priority = options?.priority || 'medium';

  // Get unreconciled transactions
  const result = await db.query<{
    id: string;
    amount: number;
    date: Date;
  }>(
    `SELECT id, amount, date
     FROM bank_transactions
     WHERE reconciled = false
       AND date >= NOW() - INTERVAL '90 days'
     ORDER BY
       CASE WHEN ABS(amount) > 10000 THEN 1 ELSE 2 END,
       date ASC
     LIMIT $1`,
    [limit]
  );

  let added = 0;
  for (const tx of result.rows) {
    try {
      await addReconciliationJob(tenantId, tx.id, priority);
      added++;
    } catch (error) {
      logger.error('Failed to add reconciliation job', {
        tenantId,
        bankTransactionId: tx.id,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  logger.info('Batch reconciliation scheduled', {
    tenantId,
    total: result.rows.length,
    added,
  });

  return added;
}
