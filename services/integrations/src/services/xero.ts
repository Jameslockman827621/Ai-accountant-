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
    await refreshXeroToken(tenantId);
    // Re-fetch connection after refresh
    const refreshed = await db.query<{
      access_token: string;
      tenant_id_xero: string;
    }>(
      'SELECT access_token, tenant_id_xero FROM xero_connections WHERE tenant_id = $1',
      [tenantId]
    );
    connection.rows[0].access_token = refreshed.rows[0].access_token;
    connection.rows[0].tenant_id_xero = refreshed.rows[0].tenant_id_xero;
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

export async function refreshXeroToken(tenantId: TenantId): Promise<void> {
  logger.info('Refreshing Xero token', { tenantId });

  const connection = await db.query<{
    refresh_token: string;
  }>(
    'SELECT refresh_token FROM xero_connections WHERE tenant_id = $1',
    [tenantId]
  );

  if (connection.rows.length === 0) {
    throw new Error('Xero not connected');
  }

  const { refresh_token } = connection.rows[0];

  try {
    // Xero token refresh
    const response = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh_token,
        client_id: process.env.XERO_CLIENT_ID || '',
        client_secret: process.env.XERO_CLIENT_SECRET || '',
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`);
    }

    const data = await response.json();
    const expiresAt = new Date(Date.now() + (data.expires_in * 1000));

    // Update stored token
    await db.query(
      `UPDATE xero_connections
       SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW()
       WHERE tenant_id = $4`,
      [data.access_token, data.refresh_token, expiresAt, tenantId]
    );

    logger.info('Xero token refreshed', { tenantId });
  } catch (error) {
    logger.error('Xero token refresh failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
