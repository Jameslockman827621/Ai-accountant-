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

  // Call QuickBooks API to get accounts
  const accessToken = connection.rows[0].access_token;
  const realmId = connection.rows[0].realm_id;
  
  const baseUrl = process.env.QUICKBOOKS_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';

  let accounts: Array<{ code: string; name: string; type: string }> = [];

  try {
    const response = await fetch(
      `${baseUrl}/v3/company/${realmId}/query?query=SELECT * FROM Account MAXRESULTS 1000`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`QuickBooks API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.QueryResponse && data.QueryResponse.Account) {
      accounts = data.QueryResponse.Account.map((acc: any) => ({
        code: acc.AcctNum || acc.Id,
        name: acc.Name,
        type: acc.AccountType,
        subType: acc.AccountSubType,
        fullyQualifiedName: acc.FullyQualifiedName,
      }));
    }
  } catch (error) {
    logger.error('Failed to fetch QuickBooks accounts', error);
    throw new Error(`Failed to sync QuickBooks accounts: ${error instanceof Error ? error.message : String(error)}`);
  }

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

  // Check if token expired and refresh if needed
  if (new Date(connection.rows[0].expires_at) < new Date()) {
    await refreshQuickBooksToken(tenantId);
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

  const accessToken = connection.rows[0].access_token;
  const realmId = connection.rows[0].realm_id;
  
  const baseUrl = process.env.QUICKBOOKS_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';

  let synced = 0;
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      // Get transactions using JournalEntry query
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      const query = `SELECT * FROM JournalEntry WHERE TxnDate >= '${startDateStr}' AND TxnDate <= '${endDateStr}' MAXRESULTS 1000`;
      const response = await fetch(
        `${baseUrl}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        if (response.status === 401 && retryCount < maxRetries - 1) {
          // Token might be expired, refresh and retry
          await refreshQuickBooksToken(tenantId);
          const refreshed = await db.query<{
            access_token: string;
            realm_id: string;
          }>(
            'SELECT access_token, realm_id FROM quickbooks_connections WHERE tenant_id = $1',
            [tenantId]
          );
          connection.rows[0].access_token = refreshed.rows[0].access_token;
          retryCount++;
          continue;
        }
        throw new Error(`QuickBooks API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.QueryResponse && data.QueryResponse.JournalEntry) {
        const transactions = Array.isArray(data.QueryResponse.JournalEntry)
          ? data.QueryResponse.JournalEntry
          : [data.QueryResponse.JournalEntry];

        for (const txn of transactions) {
          // Create bank transaction from QuickBooks journal entry
          const amount = txn.TotalAmt || 0;
          const description = txn.DocNumber || txn.TxnDate || 'QuickBooks Transaction';
          
          await db.query(
            `INSERT INTO bank_transactions (
              id, tenant_id, amount, description, transaction_date, source, source_id, created_at
            ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'quickbooks', $5, NOW())
            ON CONFLICT (tenant_id, source, source_id) DO NOTHING`,
            [tenantId, amount, description, txn.TxnDate, txn.Id]
          );
          
          synced++;
        }
      }

      break; // Success, exit retry loop
    } catch (error) {
      retryCount++;
      if (retryCount >= maxRetries) {
        logger.error('Failed to sync QuickBooks transactions after retries', error);
        throw new Error(`Failed to sync QuickBooks transactions: ${error instanceof Error ? error.message : String(error)}`);
      }
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
    }
  }
  
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
