import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('compliance-service');

export interface GDPRConsent {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  consentType: string;
  granted: boolean;
  grantedAt: Date;
  revokedAt: Date | null;
}

export async function grantConsent(
  tenantId: TenantId,
  userId: UserId,
  consentType: string,
  metadata?: Record<string, unknown>
): Promise<string> {
  const consentId = crypto.randomUUID();

  // Revoke any existing consent of this type
  await db.query(
    `UPDATE gdpr_consents
     SET revoked_at = NOW()
     WHERE tenant_id = $1 AND user_id = $2 AND consent_type = $3 AND revoked_at IS NULL`,
    [tenantId, userId, consentType]
  );

  // Grant new consent
  await db.query(
    `INSERT INTO gdpr_consents (id, tenant_id, user_id, consent_type, granted, metadata)
     VALUES ($1, $2, $3, $4, true, $5::jsonb)`,
    [consentId, tenantId, userId, consentType, JSON.stringify(metadata || {})]
  );

  logger.info('GDPR consent granted', { tenantId, userId, consentType });
  return consentId;
}

export async function revokeConsent(
  tenantId: TenantId,
  userId: UserId,
  consentType: string
): Promise<void> {
  await db.query(
    `UPDATE gdpr_consents
     SET revoked_at = NOW()
     WHERE tenant_id = $1 AND user_id = $2 AND consent_type = $3 AND revoked_at IS NULL`,
    [tenantId, userId, consentType]
  );

  logger.info('GDPR consent revoked', { tenantId, userId, consentType });
}

export async function hasConsent(
  tenantId: TenantId,
  userId: UserId,
  consentType: string
): Promise<boolean> {
  const result = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count
     FROM gdpr_consents
     WHERE tenant_id = $1 AND user_id = $2 AND consent_type = $3
       AND granted = true AND revoked_at IS NULL`,
    [tenantId, userId, consentType]
  );

  const count = typeof result.rows[0]?.count === 'number'
    ? result.rows[0].count
    : parseInt(String(result.rows[0]?.count || '0'), 10);

  return count > 0;
}

export async function exportUserData(
  tenantId: TenantId,
  userId: UserId
): Promise<Record<string, unknown>> {
  // Export all user data for GDPR right to data portability
  const userResult = await db.query(
    'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = $1 AND tenant_id = $2',
    [userId, tenantId]
  );

  const documentsResult = await db.query(
    'SELECT id, file_name, document_type, status, created_at FROM documents WHERE uploaded_by = $1 AND tenant_id = $2',
    [userId, tenantId]
  );

  const ledgerEntriesResult = await db.query(
    'SELECT id, entry_type, amount, description, transaction_date, created_at FROM ledger_entries WHERE created_by = $1 AND tenant_id = $2',
    [userId, tenantId]
  );

  return {
    user: userResult.rows[0] || null,
    documents: documentsResult.rows,
    ledgerEntries: ledgerEntriesResult.rows,
    exportedAt: new Date().toISOString(),
  };
}

export async function deleteUserData(tenantId: TenantId, userId: UserId): Promise<void> {
  // Delete all user data for GDPR right to erasure
  // Note: Some data may need to be retained for legal/compliance reasons
  
  await db.query('DELETE FROM gdpr_consents WHERE user_id = $1 AND tenant_id = $2', [userId, tenantId]);
  await db.query('UPDATE documents SET uploaded_by = NULL WHERE uploaded_by = $1 AND tenant_id = $2', [userId, tenantId]);
  await db.query('UPDATE ledger_entries SET created_by = NULL WHERE created_by = $1 AND tenant_id = $2', [userId, tenantId]);
  await db.query('DELETE FROM users WHERE id = $1 AND tenant_id = $2', [userId, tenantId]);

  logger.info('User data deleted', { userId, tenantId });
}
