import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('bank-feed-service');

export interface ConnectionHealth {
  connectionId: string;
  provider: 'plaid' | 'truelayer';
  status: 'healthy' | 'warning' | 'critical' | 'expired';
  lastSync: Date | null;
  lastSuccess: Date | null;
  lastError: string | null;
  tokenExpiresAt: Date | null;
  daysUntilExpiry: number | null;
  syncFrequency: number; // hours
  errorCount: number;
  exceptionCount: number;
  recommendations: string[];
}

/**
 * Monitor bank connection health and proactively detect issues
 */
export async function checkConnectionHealth(
  tenantId: TenantId,
  connectionId?: string
): Promise<ConnectionHealth[]> {
  logger.info('Checking connection health', { tenantId, connectionId });

  let query = `SELECT 
     id, provider, last_sync, last_success, last_error,
     token_expires_at, error_count, exception_count, is_active
   FROM bank_connections
   WHERE tenant_id = $1`;

  const params: unknown[] = [tenantId];

  if (connectionId) {
    query += ' AND id = $2';
    params.push(connectionId);
  }

  query += ' AND is_active = true ORDER BY last_sync DESC NULLS LAST';

  const result = await db.query<{
    id: string;
    provider: string;
    last_sync: Date | null;
    last_success: Date | null;
    last_error: string | null;
    token_expires_at: Date | null;
    error_count: number;
    exception_count: number;
  }>(query, params);

  const healthChecks: ConnectionHealth[] = [];

  for (const conn of result.rows) {
    const now = new Date();
    const lastSync = conn.last_sync;
    const lastSuccess = conn.last_success;
    const tokenExpiresAt = conn.token_expires_at;

    // Determine status
    let status: ConnectionHealth['status'] = 'healthy';
    const recommendations: string[] = [];

    // Check token expiry
    let daysUntilExpiry: number | null = null;
    if (tokenExpiresAt) {
      daysUntilExpiry = Math.ceil((tokenExpiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      if (daysUntilExpiry < 0) {
        status = 'expired';
        recommendations.push('Connection token has expired. Please reconnect your bank account.');
      } else if (daysUntilExpiry <= 7) {
        status = status === 'healthy' ? 'warning' : status;
        recommendations.push(`Connection token expires in ${daysUntilExpiry} days. Consider refreshing the connection.`);
      }
    }

    // Check last sync
    if (!lastSync) {
      status = 'critical';
      recommendations.push('Connection has never synced. Check connection setup.');
    } else {
      const hoursSinceSync = (now.getTime() - lastSync.getTime()) / (1000 * 60 * 60);
      const expectedSyncFrequency = 24; // Default: daily

      if (hoursSinceSync > expectedSyncFrequency * 2) {
        status = 'critical';
        recommendations.push(`Last sync was ${Math.round(hoursSinceSync / 24)} days ago. Connection may be broken.`);
      } else if (hoursSinceSync > expectedSyncFrequency) {
        status = status === 'healthy' ? 'warning' : status;
        recommendations.push(`Last sync was ${Math.round(hoursSinceSync)} hours ago. Sync may be delayed.`);
      }
    }

    // Check error count
    if (conn.error_count > 10) {
      status = 'critical';
      recommendations.push(`High error count: ${conn.error_count}. Connection may need to be re-established.`);
    } else if (conn.error_count > 5) {
      status = status === 'healthy' ? 'warning' : status;
      recommendations.push(`Elevated error count: ${conn.error_count}. Monitor connection closely.`);
    }

    // Check exception count
    if (conn.exception_count > 5) {
      status = status === 'healthy' ? 'warning' : status;
      recommendations.push(`Exception count: ${conn.exception_count}. Some syncs may have failed.`);
    }

    // Check last error
    if (conn.last_error && lastSuccess) {
      const hoursSinceError = (now.getTime() - lastSuccess.getTime()) / (1000 * 60 * 60);
      if (hoursSinceError < 24) {
        status = status === 'healthy' ? 'warning' : status;
        recommendations.push(`Recent error: ${conn.last_error.substring(0, 100)}`);
      }
    }

    healthChecks.push({
      connectionId: conn.id,
      provider: conn.provider as 'plaid' | 'truelayer',
      status,
      lastSync,
      lastSuccess,
      lastError: conn.last_error,
      tokenExpiresAt,
      daysUntilExpiry,
      syncFrequency: 24, // Default
      errorCount: conn.error_count,
      exceptionCount: conn.exception_count,
      recommendations,
    });
  }

  return healthChecks;
}

/**
 * Get connections that need attention
 */
export async function getConnectionsNeedingAttention(tenantId: TenantId): Promise<ConnectionHealth[]> {
  const allConnections = await checkConnectionHealth(tenantId);
  return allConnections.filter(
    conn => conn.status === 'warning' || conn.status === 'critical' || conn.status === 'expired'
  );
}

/**
 * Proactively check and alert on connection issues
 */
export async function performHealthCheck(tenantId: TenantId): Promise<{
  totalConnections: number;
  healthy: number;
  warning: number;
  critical: number;
  expired: number;
}> {
  const connections = await checkConnectionHealth(tenantId);

  const summary = {
    totalConnections: connections.length,
    healthy: connections.filter(c => c.status === 'healthy').length,
    warning: connections.filter(c => c.status === 'warning').length,
    critical: connections.filter(c => c.status === 'critical').length,
    expired: connections.filter(c => c.status === 'expired').length,
  };

  // Log warnings for connections needing attention
  const needsAttention = connections.filter(
    c => c.status !== 'healthy'
  );

  if (needsAttention.length > 0) {
    logger.warn('Connections need attention', {
      tenantId,
      count: needsAttention.length,
      connections: needsAttention.map(c => ({
        id: c.connectionId,
        status: c.status,
        provider: c.provider,
      })),
    });

    // In production, would trigger notifications here
  }

  return summary;
}
