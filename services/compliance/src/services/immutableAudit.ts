import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import crypto from 'crypto';

const logger = createLogger('compliance-service');

export interface ImmutableAuditLog {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  action: string;
  resourceType: string;
  resourceId: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
  hash: string; // Cryptographic hash for integrity
  previousHash?: string; // Chain of hashes
}

/**
 * Immutable audit logging with cryptographic chaining
 * Each log entry includes a hash of the previous entry to prevent tampering
 */
export async function createImmutableAuditLog(
  tenantId: TenantId,
  userId: UserId,
  action: string,
  resourceType: string,
  resourceId: string,
  changes: Record<string, { old: unknown; new: unknown }>,
  ipAddress?: string,
  userAgent?: string
): Promise<string> {
  // Get previous log entry hash for chaining
  const previousLog = await db.query<{ hash: string }>(
    `SELECT hash FROM immutable_audit_logs
     WHERE tenant_id = $1
     ORDER BY timestamp DESC
     LIMIT 1`,
    [tenantId]
  );

  const previousHash = previousLog.rows[0]?.hash || null;

  // Create log entry
  const logId = crypto.randomUUID();
  const timestamp = new Date();

  const logData = {
    id: logId,
    tenantId,
    userId,
    action,
    resourceType,
    resourceId,
    changes,
    timestamp: timestamp.toISOString(),
    ipAddress,
    userAgent,
    previousHash,
  };

  // Calculate cryptographic hash
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(logData))
    .digest('hex');

  // Store in immutable table
  await db.query(
    `INSERT INTO immutable_audit_logs (
      id, tenant_id, user_id, action, resource_type, resource_id,
      changes, timestamp, ip_address, user_agent, hash, previous_hash
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)`,
    [
      logId,
      tenantId,
      userId,
      action,
      resourceType,
      resourceId,
      JSON.stringify(changes),
      timestamp,
      ipAddress || null,
      userAgent || null,
      hash,
      previousHash,
    ]
  );

  logger.info('Immutable audit log created', { logId, tenantId, action, hash });
  return logId;
}

/**
 * Verify audit log integrity by checking hash chain
 */
export async function verifyAuditLogIntegrity(tenantId: TenantId): Promise<{
  isValid: boolean;
  errors: string[];
}> {
  const logs = await db.query<{
    id: string;
    hash: string;
    previous_hash: string | null;
    timestamp: Date;
  }>(
    `SELECT id, hash, previous_hash, timestamp
     FROM immutable_audit_logs
     WHERE tenant_id = $1
     ORDER BY timestamp ASC`,
    [tenantId]
  );

  const errors: string[] = [];

  for (let i = 0; i < logs.rows.length; i++) {
    const log = logs.rows[i];
    const prevLog = i > 0 ? logs.rows[i - 1] : null;

    // Verify previous hash matches
    if (prevLog && log.previous_hash !== prevLog.hash) {
      errors.push(`Hash chain broken at log ${log.id}`);
    }

    // Verify current hash
    const logData = await db.query<{
      id: string;
      tenant_id: string;
      user_id: string;
      action: string;
      resource_type: string;
      resource_id: string;
      changes: unknown;
      timestamp: Date;
      ip_address: string | null;
      user_agent: string | null;
      previous_hash: string | null;
    }>(
      'SELECT * FROM immutable_audit_logs WHERE id = $1',
      [log.id]
    );

    if (logData.rows.length > 0) {
      const data = logData.rows[0];
      const expectedHash = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            id: data.id,
            tenantId: data.tenant_id,
            userId: data.user_id,
            action: data.action,
            resourceType: data.resource_type,
            resourceId: data.resource_id,
            changes: data.changes,
            timestamp: data.timestamp.toISOString(),
            ipAddress: data.ip_address,
            userAgent: data.user_agent,
            previousHash: data.previous_hash,
          })
        )
        .digest('hex');

      if (expectedHash !== log.hash) {
        errors.push(`Hash mismatch for log ${log.id}`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
