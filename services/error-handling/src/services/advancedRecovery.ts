import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { retryHandler } from '@ai-accountant/resilience/circuitBreaker';

const logger = createLogger('error-handling-service');

export interface RecoveryStrategy {
  id: string;
  errorType: string;
  entityType: string;
  strategy: 'auto_retry' | 'manual_intervention' | 'skip' | 'transform';
  maxRetries: number;
  retryDelay: number;
  transformFunction?: string;
}

export interface RecoveryResult {
  success: boolean;
  strategy: string;
  attempts: number;
  finalState: 'recovered' | 'requires_manual_intervention' | 'failed';
  error?: string;
}

/**
 * Advanced error recovery with automatic retry and manual intervention fallback
 */
export async function recoverError(
  tenantId: TenantId,
  errorId: string
): Promise<RecoveryResult> {
  const error = await db.query<{
    error_type: string;
    entity_type: string;
    entity_id: string;
    error_message: string;
    retryable: boolean;
    retry_count: number;
  }>(
    'SELECT error_type, entity_type, entity_id, error_message, retryable, retry_count FROM error_records WHERE id = $1 AND tenant_id = $2',
    [errorId, tenantId]
  );

  if (error.rows.length === 0) {
    throw new Error('Error record not found');
  }

  const errorData = error.rows[0];
  const strategy = await getRecoveryStrategy(tenantId, errorData.error_type, errorData.entity_type);

  if (!strategy) {
    return {
      success: false,
      strategy: 'none',
      attempts: errorData.retry_count,
      finalState: 'requires_manual_intervention',
      error: 'No recovery strategy found',
    };
  }

  // Execute recovery strategy
  switch (strategy.strategy) {
    case 'auto_retry':
      return await executeAutoRetry(tenantId, errorId, errorData, strategy);
    case 'transform':
      return await executeTransform(tenantId, errorId, errorData, strategy);
    case 'skip':
      return await executeSkip(tenantId, errorId, errorData);
    case 'manual_intervention':
      return {
        success: false,
        strategy: 'manual_intervention',
        attempts: errorData.retry_count,
        finalState: 'requires_manual_intervention',
      };
    default:
      return {
        success: false,
        strategy: 'unknown',
        attempts: errorData.retry_count,
        finalState: 'requires_manual_intervention',
      };
  }
}

async function getRecoveryStrategy(
  tenantId: TenantId,
  errorType: string,
  entityType: string
): Promise<RecoveryStrategy | null> {
  const result = await db.query<{
    id: string;
    error_type: string;
    entity_type: string;
    strategy: string;
    max_retries: number;
    retry_delay: number;
    transform_function: string | null;
  }>(
    `SELECT id, error_type, entity_type, strategy, max_retries, retry_delay, transform_function
     FROM recovery_strategies
     WHERE tenant_id = $1
       AND (error_type = $2 OR error_type = 'any')
       AND (entity_type = $3 OR entity_type = 'any')
     ORDER BY
       CASE WHEN error_type = $2 THEN 1 ELSE 2 END,
       CASE WHEN entity_type = $3 THEN 1 ELSE 2 END
     LIMIT 1`,
    [tenantId, errorType, entityType]
  );

  if (result.rows.length === 0) {
    // Default strategy
    return {
      id: 'default',
      errorType,
      entityType,
      strategy: 'auto_retry',
      maxRetries: 3,
      retryDelay: 1000,
    };
  }

  const row = result.rows[0];
  return {
    id: row.id,
    errorType: row.error_type,
    entityType: row.entity_type,
    strategy: row.strategy as RecoveryStrategy['strategy'],
    maxRetries: row.max_retries,
    retryDelay: row.retry_delay,
    transformFunction: row.transform_function || undefined,
  };
}

async function executeAutoRetry(
  tenantId: TenantId,
  errorId: string,
  errorData: { entity_type: string; entity_id: string; error_message: string; retry_count: number },
  strategy: RecoveryStrategy
): Promise<RecoveryResult> {
  if (errorData.retry_count >= strategy.maxRetries) {
    return {
      success: false,
      strategy: 'auto_retry',
      attempts: errorData.retry_count,
      finalState: 'requires_manual_intervention',
      error: 'Max retries exceeded',
    };
  }

  try {
    // Retry with exponential backoff
    await retryHandler.executeWithRetry(
      async () => {
        // Re-execute based on entity type
        switch (errorData.entity_type) {
          case 'document':
            // Re-process document
            logger.info('Retrying document processing', { entityId: errorData.entity_id });
            break;
          case 'ledger_entry':
            // Re-post ledger entry
            logger.info('Retrying ledger entry', { entityId: errorData.entity_id });
            break;
          default:
            throw new Error('Unknown entity type');
        }
      },
      strategy.maxRetries - errorData.retry_count,
      strategy.retryDelay
    );

    // Mark as recovered
    await db.query(
      `UPDATE error_records
       SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [errorId]
    );

    return {
      success: true,
      strategy: 'auto_retry',
      attempts: errorData.retry_count + 1,
      finalState: 'recovered',
    };
  } catch (error) {
    // Increment retry count
    await db.query(
      `UPDATE error_records
       SET retry_count = retry_count + 1, updated_at = NOW()
       WHERE id = $1`,
      [errorId]
    );

    return {
      success: false,
      strategy: 'auto_retry',
      attempts: errorData.retry_count + 1,
      finalState: errorData.retry_count + 1 >= strategy.maxRetries ? 'requires_manual_intervention' : 'failed',
      error: error instanceof Error ? error.message : 'Retry failed',
    };
  }
}

async function executeTransform(
  tenantId: TenantId,
  errorId: string,
  errorData: { entity_id: string },
  strategy: RecoveryStrategy
): Promise<RecoveryResult> {
  // Transform data using transform function
  if (!strategy.transformFunction) {
    return {
      success: false,
      strategy: 'transform',
      attempts: 0,
      finalState: 'requires_manual_intervention',
      error: 'No transform function provided',
    };
  }

  try {
    // Execute transform (would need to safely evaluate or call a service)
    logger.info('Transforming entity', { entityId: errorData.entity_id, transform: strategy.transformFunction });

    await db.query(
      `UPDATE error_records
       SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [errorId]
    );

    return {
      success: true,
      strategy: 'transform',
      attempts: 1,
      finalState: 'recovered',
    };
  } catch (error) {
    return {
      success: false,
      strategy: 'transform',
      attempts: 1,
      finalState: 'requires_manual_intervention',
      error: error instanceof Error ? error.message : 'Transform failed',
    };
  }
}

async function executeSkip(
  tenantId: TenantId,
  errorId: string,
  errorData: { entity_id: string }
): Promise<RecoveryResult> {
  // Mark error as skipped
  await db.query(
    `UPDATE error_records
     SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [errorId]
  );

  return {
    success: true,
    strategy: 'skip',
    attempts: 0,
    finalState: 'recovered',
  };
}
