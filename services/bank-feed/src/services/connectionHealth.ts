import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('bank-feed-service');

export interface ConnectionHealth {
  tenantId: TenantId;
  connectionId: string;
  provider: 'plaid' | 'truelayer';
  status: 'healthy' | 'degraded' | 'down' | 'expired';
  lastSync: Date | null;
  lastSuccess: Date | null;
  errorCount: number;
  nextSync: Date | null;
}

export async function checkConnectionHealth(
  tenantId: TenantId,
  connectionId: string
): Promise<ConnectionHealth> {
  const result = await db.query<{
    provider: string;
    last_sync: Date | null;
    last_success: Date | null;
    error_count: number;
    expires_at: Date | null;
  }>(
    `SELECT provider, last_sync, last_success, error_count, expires_at
     FROM bank_connections
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, connectionId]
  );

  if (result.rows.length === 0) {
    throw new Error('Connection not found');
  }

  const conn = result.rows[0];
  const now = new Date();

  let status: ConnectionHealth['status'] = 'healthy';
  
  // Check if expired
  if (conn.expires_at && new Date(conn.expires_at) < now) {
    status = 'expired';
  }
  // Check if last sync was too long ago (>7 days)
  else if (conn.last_sync && (now.getTime() - new Date(conn.last_sync).getTime()) > 7 * 24 * 60 * 60 * 1000) {
    status = 'degraded';
  }
  // Check error count
  else if (conn.error_count > 5) {
    status = 'degraded';
  }
  // Check if last success was too long ago
  else if (!conn.last_success || (now.getTime() - new Date(conn.last_success).getTime()) > 3 * 24 * 60 * 60 * 1000) {
    status = 'degraded';
  }

  const nextSync = conn.last_sync
    ? new Date(new Date(conn.last_sync).getTime() + 24 * 60 * 60 * 1000) // 24 hours after last sync
    : new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now

  return {
    tenantId,
    connectionId,
    provider: conn.provider as ConnectionHealth['provider'],
    status,
    lastSync: conn.last_sync,
    lastSuccess: conn.last_success,
    errorCount: typeof conn.error_count === 'number' ? conn.error_count : parseInt(String(conn.error_count || '0'), 10),
    nextSync,
  };
}

export async function getAllConnectionHealth(tenantId: TenantId): Promise<ConnectionHealth[]> {
  const result = await db.query<{
    id: string;
    provider: string;
    last_sync: Date | null;
    last_success: Date | null;
    error_count: number;
    expires_at: Date | null;
  }>(
    `SELECT id, provider, last_sync, last_success, error_count, expires_at
     FROM bank_connections
     WHERE tenant_id = $1`,
    [tenantId]
  );

  return Promise.all(
    result.rows.map(row =>
      checkConnectionHealth(tenantId, row.id)
    )
  );
}

export async function recordSyncSuccess(
  tenantId: TenantId,
  connectionId: string
): Promise<void> {
  await db.query(
    `UPDATE bank_connections
     SET last_sync = NOW(),
         last_success = NOW(),
         error_count = 0,
         updated_at = NOW()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, connectionId]
  );

  logger.info('Sync success recorded', { tenantId, connectionId });
}

export async function recordSyncError(
  tenantId: TenantId,
  connectionId: string,
  error: string
): Promise<void> {
  await db.query(
    `UPDATE bank_connections
     SET last_sync = NOW(),
         error_count = error_count + 1,
         last_error = $1,
         updated_at = NOW()
     WHERE tenant_id = $2 AND id = $3`,
    [error, tenantId, connectionId]
  );

  logger.warn('Sync error recorded', { tenantId, connectionId, error });
}
