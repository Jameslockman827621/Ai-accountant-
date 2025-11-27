import crypto from 'crypto';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { applyDataRetentionPolicies } from './complianceGuardian';
import { deleteUserData } from './gdpr';

const logger = createLogger('compliance-privacy');

export interface PrivacySettings {
  defaultRetentionDays: number;
  erasureGracePeriodDays: number;
  ccpaOptOut: boolean;
  autoDeleteEnabled: boolean;
}

const DEFAULT_SETTINGS: PrivacySettings = {
  defaultRetentionDays: 365,
  erasureGracePeriodDays: 30,
  ccpaOptOut: false,
  autoDeleteEnabled: true,
};

export async function getPrivacySettings(tenantId: TenantId): Promise<PrivacySettings> {
  const result = await db.query<{
    default_retention_days: number;
    erasure_grace_period_days: number;
    ccpa_opt_out: boolean;
    auto_delete_enabled: boolean;
  }>(
    `SELECT default_retention_days, erasure_grace_period_days, ccpa_opt_out, auto_delete_enabled
     FROM privacy_settings
     WHERE tenant_id = $1`,
    [tenantId]
  );

  if (!result.rows[0]) {
    return DEFAULT_SETTINGS;
  }

  const row = result.rows[0];
  return {
    defaultRetentionDays: row.default_retention_days,
    erasureGracePeriodDays: row.erasure_grace_period_days,
    ccpaOptOut: row.ccpa_opt_out,
    autoDeleteEnabled: row.auto_delete_enabled,
  };
}

export async function upsertPrivacySettings(
  tenantId: TenantId,
  updates: Partial<PrivacySettings>
): Promise<PrivacySettings> {
  const merged: PrivacySettings = {
    ...DEFAULT_SETTINGS,
    ...updates,
  };

  await db.query(
    `INSERT INTO privacy_settings (tenant_id, default_retention_days, erasure_grace_period_days, ccpa_opt_out, auto_delete_enabled)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id)
     DO UPDATE SET default_retention_days = EXCLUDED.default_retention_days,
                   erasure_grace_period_days = EXCLUDED.erasure_grace_period_days,
                   ccpa_opt_out = EXCLUDED.ccpa_opt_out,
                   auto_delete_enabled = EXCLUDED.auto_delete_enabled,
                   updated_at = NOW()`,
    [
      tenantId,
      merged.defaultRetentionDays,
      merged.erasureGracePeriodDays,
      merged.ccpaOptOut,
      merged.autoDeleteEnabled,
    ]
  );

  logger.info('Updated privacy settings', { tenantId, updates });
  return merged;
}

export async function submitErasureRequest(
  tenantId: TenantId,
  userId: UserId,
  reason?: string
): Promise<string> {
  const requestId = crypto.randomUUID();
  await db.query(
    `INSERT INTO erasure_requests (id, tenant_id, user_id, reason, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (id) DO NOTHING`,
    [requestId, tenantId, userId, reason || null]
  );

  logger.info('Queued erasure request', { tenantId, userId, requestId });
  return requestId;
}

export async function processErasureRequests(
  tenantId: TenantId,
  executedBy?: UserId
): Promise<{ processed: number; failed: number }> {
  const pending = await db.query<{ id: string; user_id: string | null; reason: string | null }>(
    `SELECT id, user_id, reason FROM erasure_requests WHERE tenant_id = $1 AND status = 'pending'`,
    [tenantId]
  );

  let processed = 0;
  let failed = 0;

  for (const request of pending.rows) {
    const userId = request.user_id as UserId | null;
    try {
      await db.query(`UPDATE erasure_requests SET status = 'processing' WHERE id = $1`, [request.id]);

      if (userId) {
        await deleteUserData(tenantId, userId);
      }

      await db.query(
        `INSERT INTO data_deletion_log (policy_id, table_name, deletion_type, tenant_id, user_id, deleted_count, deleted_at, executed_by, deletion_reason)
         VALUES (NULL, 'users', 'gdpr', $1, $2, $3, NOW(), $4, $5)`,
        [tenantId, userId, userId ? 1 : 0, executedBy || null, request.reason || 'User erasure request']
      );

      await db.query(
        `UPDATE erasure_requests SET status = 'completed', processed_at = NOW() WHERE id = $1`,
        [request.id]
      );
      processed += 1;
    } catch (error) {
      failed += 1;
      logger.error('Failed to process erasure request', error instanceof Error ? error : new Error(String(error)));
      await db.query(
        `UPDATE erasure_requests SET status = 'failed', failure_reason = $2, processed_at = NOW() WHERE id = $1`,
        [request.id, error instanceof Error ? error.message : 'Unknown error']
      );
    }
  }

  return { processed, failed };
}

export async function runRetentionEnforcement(
  tenantId: TenantId,
  executedBy?: UserId
): Promise<
  Array<{
    tableName: string;
    policyName: string;
    rowsAffected: number;
  }>
> {
  const actions = await applyDataRetentionPolicies(tenantId);
  for (const action of actions) {
    await db.query(
      `INSERT INTO data_deletion_log (policy_id, table_name, deletion_type, tenant_id, user_id, deleted_count, deleted_at, executed_by, deletion_reason)
       VALUES (NULL, $1, 'retention', $2, NULL, $3, NOW(), $4, $5)`,
      [action.tableName, tenantId, action.rowsAffected, executedBy || null, `Retention policy ${action.policyName}`]
    );
  }
  return actions;
}
