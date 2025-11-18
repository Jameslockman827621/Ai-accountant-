import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('error-handling-service');

export interface ErrorRecord {
  id: string;
  tenantId: TenantId;
  errorType: 'processing' | 'validation' | 'network' | 'system';
  entityType: 'document' | 'ledger_entry' | 'filing' | 'transaction';
  entityId: string;
  errorMessage: string;
  retryable: boolean;
  retryCount: number;
  status: 'pending' | 'retrying' | 'resolved' | 'failed';
  resolvedAt: Date | null;
  createdAt: Date;
}

export async function recordError(
  tenantId: TenantId,
  errorType: ErrorRecord['errorType'],
  entityType: ErrorRecord['entityType'],
  entityId: string,
  errorMessage: string,
  retryable: boolean = true
): Promise<string> {
  const errorId = crypto.randomUUID();

  await db.query(
    `INSERT INTO error_records (
      id, tenant_id, error_type, entity_type, entity_id, error_message, retryable, retry_count, status, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 'pending', NOW())`,
    [errorId, tenantId, errorType, entityType, entityId, errorMessage, retryable]
  );

  logger.info('Error recorded', { errorId, tenantId, errorType, entityType, entityId });
  return errorId;
}

export async function getErrors(
  tenantId: TenantId,
  status?: ErrorRecord['status']
): Promise<ErrorRecord[]> {
  let query = 'SELECT * FROM error_records WHERE tenant_id = $1';
  const params: unknown[] = [tenantId];

  if (status) {
    query += ' AND status = $2';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC LIMIT 100';

  const result = await db.query<{
    id: string;
    tenant_id: string;
    error_type: string;
    entity_type: string;
    entity_id: string;
    error_message: string;
    retryable: boolean;
    retry_count: number;
    status: string;
    resolved_at: Date | null;
    created_at: Date;
  }>(query, params);

  return result.rows.map(row => ({
    id: row.id,
    tenantId: row.tenant_id,
    errorType: row.error_type as ErrorRecord['errorType'],
    entityType: row.entity_type as ErrorRecord['entityType'],
    entityId: row.entity_id,
    errorMessage: row.error_message,
    retryable: row.retryable,
    retryCount: row.retry_count,
    status: row.status as ErrorRecord['status'],
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  }));
}

export async function retryError(errorId: string, tenantId: TenantId): Promise<boolean> {
  const error = await db.query<{
    error_type: string;
    entity_type: string;
    entity_id: string;
    retryable: boolean;
    retry_count: number;
  }>(
    'SELECT error_type, entity_type, entity_id, retryable, retry_count FROM error_records WHERE id = $1 AND tenant_id = $2',
    [errorId, tenantId]
  );

  const errorData = error.rows[0];

  if (!errorData) {
    throw new Error('Error record not found');
  }

  if (!errorData.retryable) {
    throw new Error('Error is not retryable');
  }

  if (errorData.retry_count >= 3) {
    // Mark as failed after 3 retries
    await db.query(
      `UPDATE error_records
       SET status = 'failed', updated_at = NOW()
       WHERE id = $1`,
      [errorId]
    );
    return false;
  }

  // Update status to retrying
  await db.query(
    `UPDATE error_records
     SET status = 'retrying', retry_count = retry_count + 1, updated_at = NOW()
     WHERE id = $1`,
    [errorId]
  );

  // In production, would trigger actual retry logic based on entity_type
  // For now, simulate retry
  logger.info('Retrying error', { errorId, entityType: errorData.entity_type, entityId: errorData.entity_id });

  // Simulate retry success after a delay
  setTimeout(async () => {
    await db.query(
      `UPDATE error_records
       SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [errorId]
    );
  }, 1000);

  return true;
}

export async function resolveError(errorId: string, tenantId: TenantId): Promise<void> {
  await db.query(
    `UPDATE error_records
     SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [errorId, tenantId]
  );

  logger.info('Error resolved', { errorId, tenantId });
}
