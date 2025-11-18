import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

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
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const retryId = randomUUID();
    const retryCount = 0;
    const maxRetries = this.getMaxRetries(operationType);
    const nextRetryAt = this.calculateNextRetry(retryCount);

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
        JSON.stringify(metadata || {}),
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
    }>(
      `SELECT retry_count, max_retries
       FROM error_retries
       WHERE id = $1`,
      [retryId]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Retry not found');
    }

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
      return { shouldRetry: false };
    }

    // Schedule next retry
    const nextRetryAt = this.calculateNextRetry(newRetryCount);

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
  private calculateNextRetry(retryCount: number): Date {
    // Exponential backoff: 1min, 2min, 4min, 8min, 16min, 30min (max)
    const baseDelay = 60 * 1000; // 1 minute in milliseconds
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), 30 * 60 * 1000); // Max 30 minutes
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
}

// Singleton instance
export const errorRecoveryEngine = new ErrorRecoveryEngine();
