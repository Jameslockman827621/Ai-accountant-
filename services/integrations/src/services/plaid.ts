import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import axios from 'axios';

const logger = createLogger('integrations-service');

// Plaid API client (simplified - in production use official Plaid SDK)
const PLAID_BASE_URL = process.env.PLAID_BASE_URL || 'https://production.plaid.com';
const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET = process.env.PLAID_SECRET;

export interface PlaidConnection {
  tenantId: TenantId;
  accessToken: string;
  itemId: string;
  accountId: string;
  expiresAt: Date | null;
}

export async function connectPlaid(
  tenantId: TenantId,
  publicToken: string
): Promise<void> {
  logger.info('Connecting Plaid', { tenantId });

  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    throw new Error('Plaid credentials not configured');
  }

  try {
    // Exchange public token for access token
    const response = await axios.post(
      `${PLAID_BASE_URL}/item/public_token/exchange`,
      {
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        public_token: publicToken,
      }
    );

    const { access_token, item_id } = response.data;

    // Get accounts
    const accountsResponse = await axios.post(
      `${PLAID_BASE_URL}/accounts/get`,
      {
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        access_token: access_token,
      }
    );

    const accountId = accountsResponse.data.accounts[0]?.account_id;

    if (!accountId) {
      throw new Error('No accounts found');
    }

    // Store connection
    await db.query(
      `INSERT INTO bank_connections (
        tenant_id, provider, access_token, item_id, account_id, last_sync, last_success, created_at, updated_at
      ) VALUES ($1, 'plaid', $2, $3, $4, NOW(), NOW(), NOW(), NOW())
      ON CONFLICT (tenant_id, provider, item_id) DO UPDATE
      SET access_token = $2, account_id = $4, updated_at = NOW()`,
      [tenantId, access_token, item_id, accountId]
    );

    logger.info('Plaid connected', { tenantId, itemId: item_id });
  } catch (error) {
    logger.error('Plaid connection failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function refreshPlaidToken(tenantId: TenantId): Promise<void> {
  logger.info('Refreshing Plaid token', { tenantId });

  const connection = await db.query<{
    access_token: string;
    item_id: string;
  }>(
    'SELECT access_token, item_id FROM bank_connections WHERE tenant_id = $1 AND provider = $2',
    [tenantId, 'plaid']
  );

  if (connection.rows.length === 0) {
    throw new Error('Plaid not connected');
  }

  const { access_token, item_id } = connection.rows[0];

  try {
    // Rotate access token (Plaid's token rotation)
    const response = await axios.post(
      `${PLAID_BASE_URL}/item/access_token/invalidate`,
      {
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        access_token: access_token,
      }
    );

    const newAccessToken = response.data.new_access_token;

    // Update stored token
    await db.query(
      `UPDATE bank_connections
       SET access_token = $1, updated_at = NOW()
       WHERE tenant_id = $2 AND provider = 'plaid' AND item_id = $3`,
      [newAccessToken, tenantId, item_id]
    );

    logger.info('Plaid token refreshed', { tenantId });
  } catch (error) {
    logger.error('Plaid token refresh failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function syncPlaidTransactions(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<number> {
  logger.info('Syncing Plaid transactions', { tenantId, startDate, endDate });

  const connection = await db.query<{
    access_token: string;
    account_id: string;
  }>(
    'SELECT access_token, account_id FROM bank_connections WHERE tenant_id = $1 AND provider = $2',
    [tenantId, 'plaid']
  );

  if (connection.rows.length === 0) {
    throw new Error('Plaid not connected');
  }

  const { access_token, account_id } = connection.rows[0];

  try {
    const response = await axios.post(
      `${PLAID_BASE_URL}/transactions/get`,
      {
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        access_token: access_token,
        start_date: startDate.toISOString().split('T')[0],
        end_date: endDate.toISOString().split('T')[0],
        account_ids: [account_id],
      }
    );

    const transactions = response.data.transactions || [];
    let synced = 0;

    for (const tx of transactions) {
      // Check for duplicates
      const existing = await db.query<{ count: string | number }>(
        `SELECT COUNT(*) as count
         FROM bank_transactions
         WHERE tenant_id = $1
           AND transaction_id = $2`,
        [tenantId, tx.transaction_id]
      );

      const count = typeof existing.rows[0]?.count === 'number'
        ? existing.rows[0].count
        : parseInt(String(existing.rows[0]?.count || '0'), 10);

      if (count === 0) {
        await db.query(
          `INSERT INTO bank_transactions (
            id, tenant_id, account_id, transaction_id, date, amount, currency, description, created_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW()
          )`,
          [
            tenantId,
            account_id,
            tx.transaction_id,
            new Date(tx.date),
            tx.amount,
            tx.iso_currency_code || 'GBP',
            tx.name || tx.merchant_name || 'Plaid Transaction',
          ]
        );
        synced++;
      }
    }

    // Update last sync
    await db.query(
      `UPDATE bank_connections
       SET last_sync = NOW(), last_success = NOW(), error_count = 0, updated_at = NOW()
       WHERE tenant_id = $1 AND provider = 'plaid'`,
      [tenantId]
    );

    logger.info('Plaid transactions synced', { tenantId, synced });
    return synced;
  } catch (error) {
    // Record error
    await db.query(
      `UPDATE bank_connections
       SET last_sync = NOW(), error_count = error_count + 1, last_error = $1, updated_at = NOW()
       WHERE tenant_id = $2 AND provider = 'plaid'`,
      [error instanceof Error ? error.message : 'Sync failed', tenantId]
    );

    logger.error('Plaid sync failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
