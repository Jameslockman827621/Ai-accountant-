import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import {
  normalizeRetryPolicy,
  resolveStandardPolicy,
  RetryPolicy,
} from '@ai-accountant/resilience/errorStandards';
import { enqueueDeadLetter } from '@ai-accountant/resilience/deadLetterQueue';

const logger = createLogger('error-handling-service');

export interface RetryableOperation {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  operationType: 'document_processing' | 'bank_sync' | 'filing_submission' | 'tax_calculation' | 'other';
  operationId: string; // ID of the resource being processed
  error: string;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: Date;
  status: 'pending' | 'retrying' | 'succeeded' | 'failed' | 'cancelled';
  metadata?: Record<string, unknown>;
  errorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Automatic retry engine with exponential backoff
 * Manages retry logic for failed operations
 */
export class ErrorRecoveryEngine {
  /**
   * Schedule a retry for a failed operation
   */
  async scheduleRetry(
    tenantId: TenantId,
    userId: UserId,
    operationType: RetryableOperation['operationType'],
    operationId: string,
    error: string,
    metadata?: Record<string, unknown>,
    errorCodeHint?: string
  ): Promise<string> {
    const retryId = randomUUID();
    const retryCount = 0;
    const policy = resolveStandardPolicy('processing', errorCodeHint);
    const retryPolicy = normalizeRetryPolicy(policy.retryPolicy as Partial<RetryPolicy>);
    const maxRetries = retryPolicy.maxAttempts || this.getMaxRetries(operationType);
    const nextRetryAt = this.calculateNextRetry(retryCount, retryPolicy);

    await db.query(
      `INSERT INTO error_retries (
        id, tenant_id, user_id, operation_type, operation_id, error,
        retry_count, max_retries, next_retry_at, status, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
      [
        retryId,
        tenantId,
        userId,
        operationType,
        operationId,
        error,
        retryCount,
        maxRetries,
        nextRetryAt,
        'pending',
        JSON.stringify({ ...(metadata || {}), errorCode: policy.code, retryPolicy }),
      ]
    );

    logger.info('Retry scheduled', { retryId, operationType, operationId, nextRetryAt });

    return retryId;
  }

  /**
   * Get pending retries that are ready to be executed
   */
  async getPendingRetries(limit = 100): Promise<RetryableOperation[]> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      user_id: string;
      operation_type: string;
      operation_id: string;
      error: string;
      retry_count: number;
      max_retries: number;
      next_retry_at: Date;
      status: string;
      metadata: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT *
       FROM error_retries
       WHERE status = 'pending'
         AND next_retry_at <= NOW()
       ORDER BY next_retry_at ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id as TenantId,
      userId: row.user_id as UserId,
      operationType: row.operation_type as RetryableOperation['operationType'],
      operationId: row.operation_id,
      error: row.error,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      nextRetryAt: row.next_retry_at,
      status: row.status as RetryableOperation['status'],
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Mark a retry as succeeded
   */
  async markSucceeded(retryId: string): Promise<void> {
    await db.query(
      `UPDATE error_retries
       SET status = 'succeeded', updated_at = NOW()
       WHERE id = $1`,
      [retryId]
    );

    logger.info('Retry succeeded', { retryId });
  }

  /**
   * Increment retry count and schedule next retry, or mark as failed
   */
  async incrementRetry(retryId: string): Promise<{ shouldRetry: boolean; nextRetryAt?: Date }> {
    const result = await db.query<{
      retry_count: number;
      max_retries: number;
      metadata: string | null;
    }>(
      `SELECT retry_count, max_retries, metadata
       FROM error_retries
       WHERE id = $1`,
      [retryId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Retry not found');
    }

    const retryPolicy = this.parseRetryPolicy(row.metadata);
    const { retry_count, max_retries } = row;
    const newRetryCount = retry_count + 1;

    if (newRetryCount >= max_retries) {
      // Max retries reached, mark as failed
      await db.query(
        `UPDATE error_retries
         SET status = 'failed', updated_at = NOW()
         WHERE id = $1`,
        [retryId]
      );

      logger.warn('Retry failed after max attempts', { retryId, retryCount: newRetryCount });
      await enqueueDeadLetter({
        source: 'error-recovery.retry',
        operationId: retryId,
        error: 'Max retries reached',
        metadata: retryPolicy ? { retryPolicy } : undefined,
      });
      return { shouldRetry: false };
    }

    // Schedule next retry
    const nextRetryAt = this.calculateNextRetry(newRetryCount, retryPolicy);

    await db.query(
      `UPDATE error_retries
       SET retry_count = $1, next_retry_at = $2, status = 'pending', updated_at = NOW()
       WHERE id = $3`,
      [newRetryCount, nextRetryAt, retryId]
    );

    logger.info('Retry scheduled', { retryId, retryCount: newRetryCount, nextRetryAt });

    return { shouldRetry: true, nextRetryAt };
  }

  /**
   * Cancel a retry
   */
  async cancelRetry(retryId: string): Promise<void> {
    await db.query(
      `UPDATE error_retries
       SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1`,
      [retryId]
    );

    logger.info('Retry cancelled', { retryId });
  }

  async markFailed(retryId: string): Promise<void> {
    await db.query(
      `UPDATE error_retries
       SET status = 'failed', updated_at = NOW()
       WHERE id = $1`,
      [retryId]
    );

    logger.warn('Retry marked as failed', { retryId });
  }

  /**
   * Get retries for a specific operation
   */
  async getRetriesForOperation(
    tenantId: TenantId,
    operationType: RetryableOperation['operationType'],
    operationId: string
  ): Promise<RetryableOperation[]> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      user_id: string;
      operation_type: string;
      operation_id: string;
      error: string;
      retry_count: number;
      max_retries: number;
      next_retry_at: Date;
      status: string;
      metadata: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT *
       FROM error_retries
       WHERE tenant_id = $1
         AND operation_type = $2
         AND operation_id = $3
       ORDER BY created_at DESC`,
      [tenantId, operationType, operationId]
    );

    return result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id as TenantId,
      userId: row.user_id as UserId,
      operationType: row.operation_type as RetryableOperation['operationType'],
      operationId: row.operation_id,
      error: row.error,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      nextRetryAt: row.next_retry_at,
      status: row.status as RetryableOperation['status'],
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Calculate next retry time using exponential backoff
   */
  private calculateNextRetry(retryCount: number, retryPolicy?: RetryPolicy): Date {
    const policy = retryPolicy || normalizeRetryPolicy();
    const delay = Math.min(
      policy.initialDelayMs * Math.pow(policy.backoffMultiplier, retryCount),
      policy.maxDelayMs
    );
    return new Date(Date.now() + delay);
  }

  /**
   * Get max retries for operation type
   */
  private getMaxRetries(operationType: RetryableOperation['operationType']): number {
    const maxRetriesMap: Record<RetryableOperation['operationType'], number> = {
      document_processing: 5,
      bank_sync: 10,
      filing_submission: 3,
      tax_calculation: 3,
      other: 5,
    };

    return maxRetriesMap[operationType] || 5;
  }

  private parseRetryPolicy(metadata: string | null): RetryPolicy | undefined {
    if (!metadata) return undefined;
    try {
      const parsed = JSON.parse(metadata) as { retryPolicy?: RetryPolicy };
      return parsed.retryPolicy ? normalizeRetryPolicy(parsed.retryPolicy) : undefined;
    } catch {
      return undefined;
    }
  }
}

// Singleton instance
export const errorRecoveryEngine = new ErrorRecoveryEngine();
