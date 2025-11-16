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

  // Call Xero API to get contacts
  const accessToken = connection.rows[0].access_token;
  const tenantIdXero = connection.rows[0].tenant_id_xero;
  
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const response = await fetch('https://api.xero.com/api.xro/2.0/Contacts', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantIdXero,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401 && retryCount < maxRetries - 1) {
          // Token might be expired, refresh and retry
          await refreshXeroToken(tenantId);
          const refreshed = await db.query<{
            access_token: string;
            tenant_id_xero: string;
          }>(
            'SELECT access_token, tenant_id_xero FROM xero_connections WHERE tenant_id = $1',
            [tenantId]
          );
          connection.rows[0].access_token = refreshed.rows[0].access_token;
          retryCount++;
          continue;
        }
        throw new Error(`Xero API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.Contacts) {
        const contacts = Array.isArray(data.Contacts) ? data.Contacts : [data.Contacts];
        
        // Store contacts in database
        for (const contact of contacts) {
          await db.query(
            `INSERT INTO contacts (
              id, tenant_id, external_id, name, email, phone, type, source, created_at, updated_at
            ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 'xero', NOW(), NOW())
            ON CONFLICT (tenant_id, external_id, source) DO UPDATE
            SET name = $3, email = $4, phone = $5, type = $6, updated_at = NOW()`,
            [
              tenantId,
              contact.ContactID,
              contact.Name,
              contact.EmailAddress || null,
              contact.Phones?.[0]?.PhoneNumber || null,
              contact.IsSupplier ? 'supplier' : 'customer',
            ]
          );
        }
      }

      break; // Success, exit retry loop
    } catch (error) {
      retryCount++;
      if (retryCount >= maxRetries) {
        logger.error('Failed to sync Xero contacts after retries', error);
        throw new Error(`Failed to sync Xero contacts: ${error instanceof Error ? error.message : String(error)}`);
      }
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
    }
  }
  
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

  // Check if token expired and refresh if needed
  if (new Date(connection.rows[0].expires_at) < new Date()) {
    await refreshXeroToken(tenantId);
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

  const accessToken = connection.rows[0].access_token;
  const tenantIdXero = connection.rows[0].tenant_id_xero;
  
  let synced = 0;
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      // Format dates for Xero API
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      const response = await fetch(
        `https://api.xero.com/api.xro/2.0/BankTransactions?where=Date>=DateTime(${startDateStr})&where=Date<=DateTime(${endDateStr})`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Xero-tenant-id': tenantIdXero,
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        if (response.status === 401 && retryCount < maxRetries - 1) {
          // Token might be expired, refresh and retry
          await refreshXeroToken(tenantId);
          const refreshed = await db.query<{
            access_token: string;
            tenant_id_xero: string;
          }>(
            'SELECT access_token, tenant_id_xero FROM xero_connections WHERE tenant_id = $1',
            [tenantId]
          );
          connection.rows[0].access_token = refreshed.rows[0].access_token;
          retryCount++;
          continue;
        }
        throw new Error(`Xero API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.BankTransactions) {
        const transactions = Array.isArray(data.BankTransactions)
          ? data.BankTransactions
          : [data.BankTransactions];

        for (const txn of transactions) {
          const amount = txn.Total || 0;
          const description = txn.Reference || txn.LineItems?.[0]?.Description || 'Xero Transaction';
          
          await db.query(
            `INSERT INTO bank_transactions (
              id, tenant_id, amount, description, transaction_date, source, source_id, created_at
            ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'xero', $5, NOW())
            ON CONFLICT (tenant_id, source, source_id) DO NOTHING`,
            [tenantId, amount, description, txn.Date, txn.BankTransactionID]
          );
          
          synced++;
        }
      }

      break; // Success, exit retry loop
    } catch (error) {
      retryCount++;
      if (retryCount >= maxRetries) {
        logger.error('Failed to sync Xero transactions after retries', error);
        throw new Error(`Failed to sync Xero transactions: ${error instanceof Error ? error.message : String(error)}`);
      }
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
    }
  }
  
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
