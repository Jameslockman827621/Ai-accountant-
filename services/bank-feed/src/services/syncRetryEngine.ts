import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('bank-feed-service');

export interface SyncRetry {
  id: string;
  connectionId: string;
  tenantId: TenantId;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: Date;
  lastError: string;
  status: 'pending' | 'retrying' | 'succeeded' | 'failed';
  createdAt: Date;
}

/**
 * Automatic retry engine for failed bank syncs with exponential backoff
 */
export class SyncRetryEngine {
  /**
   * Schedule a retry for a failed sync
   */
  async scheduleRetry(
    tenantId: TenantId,
    connectionId: string,
    error: string
  ): Promise<string> {
    const retryId = randomUUID();

    // Check existing retry
    const existingResult = await db.query<{
      id: string;
      retry_count: number;
      max_retries: number;
    }>(
      `SELECT id, retry_count, max_retries
       FROM bank_sync_retries
       WHERE connection_id = $1 AND tenant_id = $2 AND status = 'pending'`,
      [connectionId, tenantId]
    );

    if (existingResult.rows.length > 0) {
      const existing = existingResult.rows[0];
      const newRetryCount = existing.retry_count + 1;

      if (newRetryCount >= existing.max_retries) {
        // Mark as failed
        await db.query(
          `UPDATE bank_sync_retries
           SET status = 'failed', updated_at = NOW()
           WHERE id = $1`,
          [existing.id]
        );

        // Update connection error count
        await db.query(
          `UPDATE bank_connections
           SET error_count = error_count + 1,
               last_error = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [error, connectionId]
        );

        throw new Error('Max retries reached for this sync');
      }

      // Update existing retry
      const nextRetryAt = this.calculateNextRetry(newRetryCount);
      await db.query(
        `UPDATE bank_sync_retries
         SET retry_count = $1,
             next_retry_at = $2,
             last_error = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [newRetryCount, nextRetryAt, error, existing.id]
      );

      return existing.id;
    }

    // Create new retry
    const maxRetries = 5;
    const nextRetryAt = this.calculateNextRetry(0);

    await db.query(
      `INSERT INTO bank_sync_retries (
        id, connection_id, tenant_id, retry_count, max_retries,
        next_retry_at, last_error, status, created_at, updated_at
      ) VALUES ($1, $2, $3, 0, $4, $5, $6, 'pending', NOW(), NOW())`,
      [retryId, connectionId, tenantId, maxRetries, nextRetryAt, error]
    );

    logger.info('Sync retry scheduled', { retryId, connectionId, nextRetryAt });

    return retryId;
  }

  /**
   * Get pending retries ready to execute
   */
  async getPendingRetries(limit = 100): Promise<SyncRetry[]> {
    const result = await db.query<{
      id: string;
      connection_id: string;
      tenant_id: string;
      retry_count: number;
      max_retries: number;
      next_retry_at: Date;
      last_error: string;
      status: string;
      created_at: Date;
    }>(
      `SELECT *
       FROM bank_sync_retries
       WHERE status = 'pending'
         AND next_retry_at <= NOW()
       ORDER BY next_retry_at ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      connectionId: row.connection_id,
      tenantId: row.tenant_id as TenantId,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      nextRetryAt: row.next_retry_at,
      lastError: row.last_error,
      status: row.status as SyncRetry['status'],
      createdAt: row.created_at,
    }));
  }

  /**
   * Mark retry as succeeded
   */
  async markSucceeded(retryId: string): Promise<void> {
    await db.query(
      `UPDATE bank_sync_retries
       SET status = 'succeeded', updated_at = NOW()
       WHERE id = $1`,
      [retryId]
    );

    logger.info('Sync retry succeeded', { retryId });
  }

  /**
   * Mark retry as failed (after max retries)
   */
  async markFailed(retryId: string): Promise<void> {
    await db.query(
      `UPDATE bank_sync_retries
       SET status = 'failed', updated_at = NOW()
       WHERE id = $1`,
      [retryId]
    );

    logger.warn('Sync retry failed after max attempts', { retryId });
  }

  /**
   * Calculate next retry time using exponential backoff
   */
  private calculateNextRetry(retryCount: number): Date {
    // Exponential backoff: 1hr, 2hr, 4hr, 8hr, 24hr (max)
    const baseDelay = 60 * 60 * 1000; // 1 hour in milliseconds
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), 24 * 60 * 60 * 1000); // Max 24 hours
    return new Date(Date.now() + delay);
  }
}

// Singleton instance
export const syncRetryEngine = new SyncRetryEngine();
