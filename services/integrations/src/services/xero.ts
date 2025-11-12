import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

const logger = createLogger('integrations-service');

export async function connectXero(
  tenantId: TenantId,
  accessToken: string,
  refreshToken: string,
  tenantIdXero: string
): Promise<void> {
  await db.query(
    `INSERT INTO xero_connections (tenant_id, access_token, refresh_token, tenant_id_xero, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 minutes', NOW(), NOW())
     ON CONFLICT (tenant_id) DO UPDATE
     SET access_token = $2, refresh_token = $3, tenant_id_xero = $4, expires_at = NOW() + INTERVAL '30 minutes', updated_at = NOW()`,
    [tenantId, accessToken, refreshToken, tenantIdXero]
  );

  logger.info('Xero connected', { tenantId });
}

export async function syncXeroContacts(tenantId: TenantId): Promise<void> {
  logger.info('Syncing Xero contacts', { tenantId });
  // Placeholder - would call Xero API
}

export async function syncXeroTransactions(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<number> {
  logger.info('Syncing Xero transactions', { tenantId, startDate, endDate });
  // Placeholder - would call Xero API
  return 0;
}
