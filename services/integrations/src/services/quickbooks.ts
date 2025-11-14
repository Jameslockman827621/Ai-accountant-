import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

const logger = createLogger('integrations-service');

export interface QuickBooksConnection {
  tenantId: TenantId;
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: Date;
}

export async function connectQuickBooks(
  tenantId: TenantId,
  accessToken: string,
  refreshToken: string,
  realmId: string
): Promise<void> {
  await db.query(
    `INSERT INTO quickbooks_connections (tenant_id, access_token, refresh_token, realm_id, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', NOW(), NOW())
     ON CONFLICT (tenant_id) DO UPDATE
     SET access_token = $2, refresh_token = $3, realm_id = $4, expires_at = NOW() + INTERVAL '1 hour', updated_at = NOW()`,
    [tenantId, accessToken, refreshToken, realmId]
  );

  logger.info('QuickBooks connected', { tenantId });
}

export async function syncQuickBooksAccounts(tenantId: TenantId): Promise<void> {
  logger.info('Syncing QuickBooks accounts', { tenantId });
  
  // Get QuickBooks connection
  const connection = await db.query<{
    access_token: string;
    realm_id: string;
    expires_at: Date;
  }>(
    'SELECT access_token, realm_id, expires_at FROM quickbooks_connections WHERE tenant_id = $1',
    [tenantId]
  );

  if (connection.rows.length === 0) {
    throw new Error('QuickBooks not connected');
  }

  // Check if token expired and refresh if needed
  if (new Date(connection.rows[0].expires_at) < new Date()) {
    await refreshQuickBooksToken(tenantId);
    // Re-fetch connection after refresh
    const refreshed = await db.query<{
      access_token: string;
      realm_id: string;
    }>(
      'SELECT access_token, realm_id FROM quickbooks_connections WHERE tenant_id = $1',
      [tenantId]
    );
    connection.rows[0].access_token = refreshed.rows[0].access_token;
    connection.rows[0].realm_id = refreshed.rows[0].realm_id;
  }

  // In production, call QuickBooks API:
  // const response = await fetch(
  //   `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/accounts`,
  //   {
  //     headers: {
  //       'Authorization': `Bearer ${accessToken}`,
  //       'Accept': 'application/json',
  //     },
  //   }
  // );
  // const data = await response.json();
  // const accounts = data.QueryResponse.Account.map((acc: any) => ({
  //   code: acc.AcctNum || acc.Id,
  //   name: acc.Name,
  //   type: acc.AccountType,
  // }));

  // For now, use placeholder
  const accounts = [
    { code: '4000', name: 'Sales', type: 'Income' },
    { code: '5000', name: 'Cost of Sales', type: 'Cost of Goods Sold' },
    { code: '6000', name: 'Expenses', type: 'Expense' },
  ];

  await db.query(
    `UPDATE chart_of_accounts
     SET accounts = $1::jsonb, updated_at = NOW()
     WHERE tenant_id = $2`,
    [JSON.stringify(accounts), tenantId]
  );

  logger.info('QuickBooks accounts synced', { tenantId });
}

export async function syncQuickBooksTransactions(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<number> {
  logger.info('Syncing QuickBooks transactions', { tenantId, startDate, endDate });
  
  // Get QuickBooks connection
  const connection = await db.query<{
    access_token: string;
    realm_id: string;
    expires_at: Date;
  }>(
    'SELECT access_token, realm_id, expires_at FROM quickbooks_connections WHERE tenant_id = $1',
    [tenantId]
  );

  if (connection.rows.length === 0) {
    throw new Error('QuickBooks not connected');
  }

  // In production, call QuickBooks API:
  // const response = await fetch(
  //   `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/reports/TransactionList?start_date=${startDate.toISOString().split('T')[0]}&end_date=${endDate.toISOString().split('T')[0]}`,
  //   {
  //     headers: {
  //       'Authorization': `Bearer ${accessToken}`,
  //       'Accept': 'application/json',
  //     },
  //   }
  // );
  // const data = await response.json();
  
  // Create bank_transactions from QuickBooks data
  let synced = 0;
  
  logger.info('QuickBooks transactions synced', { tenantId, synced });
  return synced;
}

export async function refreshQuickBooksToken(tenantId: TenantId): Promise<void> {
  logger.info('Refreshing QuickBooks token', { tenantId });

  const connection = await db.query<{
    refresh_token: string;
  }>(
    'SELECT refresh_token FROM quickbooks_connections WHERE tenant_id = $1',
    [tenantId]
  );

  if (connection.rows.length === 0) {
    throw new Error('QuickBooks not connected');
  }

  const { refresh_token } = connection.rows[0];

  try {
    // QuickBooks token refresh
    const response = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refresh_token,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`);
    }

    const data = await response.json();
    const expiresAt = new Date(Date.now() + (data.expires_in * 1000));

    // Update stored token
    await db.query(
      `UPDATE quickbooks_connections
       SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW()
       WHERE tenant_id = $4`,
      [data.access_token, data.refresh_token, expiresAt, tenantId]
    );

    logger.info('QuickBooks token refreshed', { tenantId });
  } catch (error) {
    logger.error('QuickBooks token refresh failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
