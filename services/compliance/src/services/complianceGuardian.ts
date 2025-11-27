import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { createImmutableAuditLog } from './immutableAudit';

const logger = createLogger('compliance-guardian');

export interface RbacDecision {
  allowed: boolean;
  reason?: string;
}

export interface RetentionAction {
  tableName: string;
  policyName: string;
  rowsAffected: number;
}

/**
 * Enforce RBAC policies for sensitive actions and capture immutable evidence.
 */
export async function enforceRbac(
  tenantId: TenantId,
  userId: UserId,
  action: string,
  resourceType: string,
  resourceId: string,
  allowedRoles: string[]
): Promise<RbacDecision> {
  const result = await db.query<{ role: string }>(
    `SELECT role FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [userId, tenantId]
  );

  const role = result.rows[0]?.role;
  const allowed = !!role && allowedRoles.includes(role);

  await createImmutableAuditLog(
    tenantId,
    userId,
    'rbac_check',
    resourceType,
    resourceId,
    {
      action: { old: null, new: action },
      role: { old: null, new: role },
      allowed: { old: null, new: allowed },
    }
  );

  if (!allowed) {
    logger.warn('RBAC enforcement denied action', { tenantId, userId, action, resourceType });
    return { allowed: false, reason: 'User role not permitted' };
  }

  return { allowed: true };
}

/**
 * Apply data retention policies defined for the tenant.
 */
export async function applyDataRetentionPolicies(tenantId: TenantId): Promise<RetentionAction[]> {
  const policies = await db.query<{
    id: string;
    policy_name: string;
    table_name: string;
    retention_days: number;
  }>(
    `SELECT id, policy_name, table_name, retention_days
     FROM data_retention_policies
     WHERE enabled = true`
  );

  const actions: RetentionAction[] = [];

  for (const policy of policies.rows) {
    const table = policy.table_name;
    const cutoff = `${policy.retention_days} days`;
    const result = await db.query<{ rows_deleted: number }>(
      `DELETE FROM ${table}
       WHERE tenant_id = $1 AND created_at < NOW() - INTERVAL '${cutoff}'
       RETURNING 1 as rows_deleted`,
      [tenantId]
    );

    const rowsAffected = result.rowCount || 0;
    actions.push({ tableName: table, policyName: policy.policy_name, rowsAffected });

    await createImmutableAuditLog(
      tenantId,
      '00000000-0000-0000-0000-000000000000' as UserId,
      'data_retention',
      table,
      policy.id,
      {
        retentionDays: { old: null, new: policy.retention_days },
        rowsDeleted: { old: null, new: rowsAffected },
      }
    );
  }

  return actions;
}

/**
 * Record access to compliance-sensitive records in an immutable log.
 */
export async function auditComplianceAccess(
  tenantId: TenantId,
  userId: UserId,
  resourceType: string,
  resourceId: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  return createImmutableAuditLog(
    tenantId,
    userId,
    'resource_access',
    resourceType,
    resourceId,
    {
      metadata: { old: null, new: metadata },
    }
  );
}
