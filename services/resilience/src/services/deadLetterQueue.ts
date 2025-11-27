import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('dead-letter-queue');

export interface DeadLetterMessage {
  id: string;
  sourceService: string;
  payload: Record<string, unknown>;
  reason: string;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date | null;
  createdAt: Date;
}

interface EnqueueOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_DELAY_MS = 5 * 60 * 1000;

export async function enqueueDeadLetter(
  sourceService: string,
  payload: Record<string, unknown>,
  reason: string,
  options: EnqueueOptions = {}
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const result = await db.query<{ id: string }>(
    `INSERT INTO dead_letter_queue (
      source_service,
      payload,
      reason,
      attempts,
      max_attempts,
      next_retry_at
    ) VALUES ($1, $2::jsonb, $3, 0, $4, NOW() + ($5 || ' milliseconds')::interval)
    RETURNING id`,
    [sourceService, JSON.stringify(payload), reason, maxAttempts, retryDelayMs]
  );

  const id = result.rows[0]?.id;
  logger.warn('Enqueued message to DLQ', { id, sourceService, reason });
  return id;
}

export async function fetchDeadLetters(
  sourceService: string,
  limit = 25
): Promise<DeadLetterMessage[]> {
  const result = await db.query<{
    id: string;
    source_service: string;
    payload: Record<string, unknown>;
    reason: string;
    attempts: number;
    max_attempts: number;
    next_retry_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, source_service, payload, reason, attempts, max_attempts, next_retry_at, created_at
     FROM dead_letter_queue
     WHERE source_service = $1
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
     ORDER BY created_at ASC
     LIMIT $2`,
    [sourceService, limit]
  );

  return result.rows.map(row => ({
    id: row.id,
    sourceService: row.source_service,
    payload: row.payload,
    reason: row.reason,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
  }));
}

export async function markDeadLetterRetry(
  id: string,
  options: { retryDelayMs?: number; error?: string } = {}
): Promise<void> {
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  await db.query(
    `UPDATE dead_letter_queue
     SET attempts = attempts + 1,
         last_error = $2,
         next_retry_at = NOW() + ($3 || ' milliseconds')::interval,
         updated_at = NOW()
     WHERE id = $1`,
    [id, options.error || null, retryDelayMs]
  );
}

export async function markDeadLetterResolved(id: string): Promise<void> {
  await db.query(
    `UPDATE dead_letter_queue
     SET resolved_at = NOW(),
         next_retry_at = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [id]
  );
}

export async function markDeadLetterFailed(id: string): Promise<void> {
  await db.query(
    `UPDATE dead_letter_queue
     SET failed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [id]
  );
}
