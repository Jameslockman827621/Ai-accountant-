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
  
  // Get Xero connection
  const connection = await db.query<{
    access_token: string;
    tenant_id_xero: string;
    expires_at: Date;
  }>(
    'SELECT access_token, tenant_id_xero, expires_at FROM xero_connections WHERE tenant_id = $1',
    [tenantId]
  );

  if (connection.rows.length === 0) {
    throw new Error('Xero not connected');
  }

  // Check if token expired and refresh if needed
  if (new Date(connection.rows[0].expires_at) < new Date()) {
    // In production, refresh token using refresh_token
    throw new Error('Xero access token expired - please reconnect');
  }

  // In production, call Xero API:
  // const response = await fetch('https://api.xero.com/api.xro/2.0/Contacts', {
  //   headers: {
  //     'Authorization': `Bearer ${accessToken}`,
  //     'Xero-tenant-id': tenantIdXero,
  //   },
  // });
  // const contacts = await response.json();
  
  logger.info('Xero contacts synced', { tenantId });
}

export async function syncXeroTransactions(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<number> {
  logger.info('Syncing Xero transactions', { tenantId, startDate, endDate });
  
  // Get Xero connection
  const connection = await db.query<{
    access_token: string;
    tenant_id_xero: string;
    expires_at: Date;
  }>(
    'SELECT access_token, tenant_id_xero, expires_at FROM xero_connections WHERE tenant_id = $1',
    [tenantId]
  );

  if (connection.rows.length === 0) {
    throw new Error('Xero not connected');
  }

  // In production, call Xero API to get transactions
  // const response = await fetch(
  //   `https://api.xero.com/api.xro/2.0/BankTransactions?where=Date>=DateTime(${startDate.toISOString()})&where=Date<=DateTime(${endDate.toISOString()})`,
  //   {
  //     headers: {
  //       'Authorization': `Bearer ${accessToken}`,
  //       'Xero-tenant-id': tenantIdXero,
  //     },
  //   }
  // );
  // const transactions = await response.json();
  
  // Create bank_transactions from Xero data
  let synced = 0;
  
  logger.info('Xero transactions synced', { tenantId, synced });
  return synced;
}
