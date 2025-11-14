import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import crypto from 'crypto';

const logger = createLogger('compliance-service');

export interface AuditLog {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  action: string;
  resourceType: 'document' | 'ledger_entry' | 'filing' | 'transaction' | 'user' | 'settings';
  resourceId: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  hash: string; // Immutable hash for integrity
}

/**
 * Create immutable audit log entry
 */
export async function createAuditLog(
  tenantId: TenantId,
  userId: UserId,
  action: string,
  resourceType: AuditLog['resourceType'],
  resourceId: string,
  changes: Record<string, { old: unknown; new: unknown }>,
  ipAddress?: string,
  userAgent?: string
): Promise<string> {
  const logId = crypto.randomUUID();
  const timestamp = new Date();

  // Create immutable hash
  const hashInput = JSON.stringify({
    logId,
    tenantId,
    userId,
    action,
    resourceType,
    resourceId,
    changes,
    timestamp: timestamp.toISOString(),
  });

  const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

  await db.query(
    `INSERT INTO audit_logs (
      id, tenant_id, user_id, action, resource_type, resource_id, changes, ip_address, user_agent, timestamp, hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
    [logId, tenantId, userId, action, resourceType, resourceId, JSON.stringify(changes), ipAddress || null, userAgent || null, timestamp, hash]
  );

  logger.info('Audit log created', { logId, tenantId, userId, action, resourceType, resourceId });
  return logId;
}

/**
 * Verify audit log integrity
 */
export async function verifyAuditLogIntegrity(logId: string): Promise<boolean> {
  const result = await db.query<{
    tenant_id: string;
    user_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    changes: unknown;
    timestamp: Date;
    hash: string;
  }>(
    'SELECT tenant_id, user_id, action, resource_type, resource_id, changes, timestamp, hash FROM audit_logs WHERE id = $1',
    [logId]
  );

  if (result.rows.length === 0) {
    return false;
  }

  const log = result.rows[0];
  const hashInput = JSON.stringify({
    logId,
    tenantId: log.tenant_id,
    userId: log.user_id,
    action: log.action,
    resourceType: log.resource_type,
    resourceId: log.resource_id,
    changes: log.changes,
    timestamp: log.timestamp.toISOString(),
  });

  const calculatedHash = crypto.createHash('sha256').update(hashInput).digest('hex');
  return calculatedHash === log.hash;
}

/**
 * Get audit trail for a resource
 */
export async function getAuditTrail(
  tenantId: TenantId,
  resourceType: AuditLog['resourceType'],
  resourceId: string
): Promise<AuditLog[]> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    user_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    changes: unknown;
    ip_address: string | null;
    user_agent: string | null;
    timestamp: Date;
    hash: string;
  }>(
    `SELECT id, tenant_id, user_id, action, resource_type, resource_id, changes, ip_address, user_agent, timestamp, hash
     FROM audit_logs
     WHERE tenant_id = $1 AND resource_type = $2 AND resource_id = $3
     ORDER BY timestamp DESC`,
    [tenantId, resourceType, resourceId]
  );

  return result.rows.map(row => ({
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    action: row.action,
    resourceType: row.resource_type as AuditLog['resourceType'],
    resourceId: row.resource_id,
    changes: row.changes as Record<string, { old: unknown; new: unknown }>,
    ipAddress: row.ip_address || undefined,
    userAgent: row.user_agent || undefined,
    timestamp: row.timestamp,
    hash: row.hash,
  }));
}
