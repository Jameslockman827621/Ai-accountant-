import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('compliance-service');

export interface AuditLog {
  id: string;
  tenantId: TenantId;
  userId: UserId | null;
  action: string;
  resourceType: string;
  resourceId: string;
  changes: Record<string, unknown> | null;
  modelVersion: string | null;
  reasoningTrace: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export async function getAuditLogs(
  tenantId: TenantId,
  filters: {
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }
): Promise<{ logs: AuditLog[]; total: number }> {
  let query = 'SELECT * FROM audit_logs WHERE tenant_id = $1';
  const params: unknown[] = [tenantId];
  let paramCount = 2;

  if (filters.userId) {
    query += ` AND user_id = $${paramCount++}`;
    params.push(filters.userId);
  }

  if (filters.resourceType) {
    query += ` AND resource_type = $${paramCount++}`;
    params.push(filters.resourceType);
  }

  if (filters.resourceId) {
    query += ` AND resource_id = $${paramCount++}`;
    params.push(filters.resourceId);
  }

  if (filters.startDate) {
    query += ` AND created_at >= $${paramCount++}`;
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    query += ` AND created_at <= $${paramCount++}`;
    params.push(filters.endDate);
  }

  // Get total count
  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
  const countResult = await db.query<{ total: string | number }>(countQuery, params);
  const total = typeof countResult.rows[0]?.total === 'number'
    ? countResult.rows[0].total
    : parseInt(String(countResult.rows[0]?.total || '0'), 10);

  // Apply pagination
  query += ' ORDER BY created_at DESC';
  if (filters.limit) {
    query += ` LIMIT $${paramCount++}`;
    params.push(filters.limit);
  }
  if (filters.offset) {
    query += ` OFFSET $${paramCount++}`;
    params.push(filters.offset);
  }

  const result = await db.query<{
    id: string;
    tenant_id: string;
    user_id: string | null;
    action: string;
    resource_type: string;
    resource_id: string;
    changes: unknown;
    model_version: string | null;
    reasoning_trace: string | null;
    ip_address: string | null;
    user_agent: string | null;
    created_at: Date;
  }>(query, params);

  return {
    logs: result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      changes: row.changes as Record<string, unknown> | null,
      modelVersion: row.model_version,
      reasoningTrace: row.reasoning_trace,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    })),
    total,
  };
}

export async function createAuditLog(
  tenantId: TenantId,
  userId: UserId | null,
  action: string,
  resourceType: string,
  resourceId: string,
  changes?: Record<string, unknown>,
  ipAddress?: string,
  userAgent?: string
): Promise<string> {
  const logId = crypto.randomUUID();

  await db.query(
    `INSERT INTO audit_logs (
      id, tenant_id, user_id, action, resource_type, resource_id,
      changes, ip_address, user_agent, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, NOW())`,
    [
      logId,
      tenantId,
      userId,
      action,
      resourceType,
      resourceId,
      changes ? JSON.stringify(changes) : null,
      ipAddress || null,
      userAgent || null,
    ]
  );

  logger.debug('Audit log created', { logId, tenantId, action, resourceType });
  return logId;
}
