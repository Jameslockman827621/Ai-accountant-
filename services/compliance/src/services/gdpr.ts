import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('compliance-service');

export async function deleteUserData(tenantId: TenantId, userId: UserId): Promise<void> {
  logger.info('Deleting user data for GDPR compliance', { tenantId, userId });

  await db.transaction(async (client) => {
    // Anonymize user data instead of deleting (for audit trail)
    await client.query(
      `UPDATE users
       SET email = $1, name = $2, password_hash = $3, is_active = false
       WHERE id = $4 AND tenant_id = $5`,
      [
        `deleted-${userId}@deleted.local`,
        'Deleted User',
        'deleted',
        userId,
        tenantId,
      ]
    );

    // Anonymize documents uploaded by user
    await client.query(
      `UPDATE documents
       SET uploaded_by = NULL, file_name = 'deleted', storage_key = 'deleted'
       WHERE uploaded_by = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );

    // Anonymize ledger entries created by user
    await client.query(
      `UPDATE ledger_entries
       SET created_by = NULL, description = 'Deleted entry'
       WHERE created_by = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );

    logger.info('User data deleted', { tenantId, userId });
  });
}

export async function exportUserData(tenantId: TenantId, userId: UserId): Promise<Record<string, unknown>> {
  logger.info('Exporting user data for GDPR compliance', { tenantId, userId });

  const [userResult, documentsResult, ledgerResult, auditResult] = await Promise.all([
    db.query('SELECT * FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]),
    db.query('SELECT * FROM documents WHERE uploaded_by = $1 AND tenant_id = $2', [userId, tenantId]),
    db.query('SELECT * FROM ledger_entries WHERE created_by = $1 AND tenant_id = $2', [userId, tenantId]),
    db.query('SELECT * FROM audit_logs WHERE user_id = $1 AND tenant_id = $2', [userId, tenantId]),
  ]) as [
    { rows: Array<Record<string, unknown>> },
    { rows: Array<Record<string, unknown>> },
    { rows: Array<Record<string, unknown>> },
    { rows: Array<Record<string, unknown>> },
  ];

  return {
    user: userResult.rows[0] || null,
    documents: documentsResult.rows,
    ledgerEntries: ledgerResult.rows,
    auditLogs: auditResult.rows,
    exportedAt: new Date().toISOString(),
  };
}

export async function getAuditLogs(
  tenantId: TenantId,
  filters: {
    userId?: UserId;
    resourceType?: string;
    resourceId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ logs: unknown[]; total: number }> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramCount = 2;

  if (filters.userId) {
    conditions.push(`user_id = $${paramCount++}`);
    params.push(filters.userId);
  }

  if (filters.resourceType) {
    conditions.push(`resource_type = $${paramCount++}`);
    params.push(filters.resourceType);
  }

  if (filters.resourceId) {
    conditions.push(`resource_id = $${paramCount++}`);
    params.push(filters.resourceId);
  }

  if (filters.startDate) {
    conditions.push(`created_at >= $${paramCount++}`);
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    conditions.push(`created_at <= $${paramCount++}`);
    params.push(filters.endDate);
  }

  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  const logsResult = await db.query(
    `SELECT * FROM audit_logs
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    [...params, limit, offset]
  );

  const countResult = await db.query(
    `SELECT COUNT(*) as total FROM audit_logs WHERE ${conditions.join(' AND ')}`,
    params
  );

  const totalRow = countResult.rows[0];
  const total = totalRow ? (typeof totalRow.total === 'number' ? totalRow.total : parseInt(String(totalRow.total || '0'), 10)) : 0;
  
  return {
    logs: logsResult.rows,
    total,
  };
}
