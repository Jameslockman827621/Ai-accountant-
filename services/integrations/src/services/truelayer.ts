import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import axios from 'axios';

const logger = createLogger('integrations-service');

const TRUELAYER_BASE_URL = process.env.TRUELAYER_BASE_URL || 'https://api.truelayer.com';
const TRUELAYER_CLIENT_ID = process.env.TRUELAYER_CLIENT_ID;
const TRUELAYER_CLIENT_SECRET = process.env.TRUELAYER_CLIENT_SECRET;

export interface TrueLayerConnection {
  tenantId: TenantId;
  accessToken: string;
  refreshToken: string;
  accountId: string;
  expiresAt: Date;
}

export async function connectTrueLayer(
  tenantId: TenantId,
  authorizationCode: string,
  redirectUri: string
): Promise<void> {
  logger.info('Connecting TrueLayer', { tenantId });

  if (!TRUELAYER_CLIENT_ID || !TRUELAYER_CLIENT_SECRET) {
    throw new Error('TrueLayer credentials not configured');
  }

  try {
    // Exchange authorization code for tokens
    const response = await axios.post(
      `${TRUELAYER_BASE_URL}/connect/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: TRUELAYER_CLIENT_ID,
        client_secret: TRUELAYER_CLIENT_SECRET,
        code: authorizationCode,
        redirect_uri: redirectUri,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Get accounts
    const accountsResponse = await axios.get(
      `${TRUELAYER_BASE_URL}/data/v1/accounts`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const accountId = accountsResponse.data.results[0]?.account_id;

    if (!accountId) {
      throw new Error('No accounts found');
    }

    // Store connection
    await db.query(
      `INSERT INTO bank_connections (
        tenant_id, provider, access_token, account_id, expires_at, metadata, last_sync, last_success, created_at, updated_at
      ) VALUES ($1, 'truelayer', $2, $4, $3, $5::jsonb, NOW(), NOW(), NOW(), NOW())
      ON CONFLICT (tenant_id, provider, item_id) DO UPDATE
      SET access_token = $2, expires_at = $3, metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{refresh_token}', $6::jsonb), updated_at = NOW()`,
      [
        tenantId,
        access_token,
        expiresAt,
        accountId,
        JSON.stringify({ refresh_token }),
        JSON.stringify(refresh_token),
      ]
    );

    logger.info('TrueLayer connected', { tenantId, accountId });
  } catch (error) {
    logger.error('TrueLayer connection failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function refreshTrueLayerToken(tenantId: TenantId): Promise<void> {
  logger.info('Refreshing TrueLayer token', { tenantId });

  const connection = await db.query<{
    access_token: string;
    account_id: string;
    metadata: unknown;
  }>(
    'SELECT access_token, account_id, metadata FROM bank_connections WHERE tenant_id = $1 AND provider = $2',
    [tenantId, 'truelayer']
  );

  if (connection.rows.length === 0) {
    throw new Error('TrueLayer not connected');
  }

  const { metadata } = connection.rows[0];
  const refreshToken = (metadata as Record<string, unknown>)?.refresh_token as string | undefined;

  if (!refreshToken) {
    throw new Error('Refresh token not found');
  }

  try {
    const response = await axios.post(
      `${TRUELAYER_BASE_URL}/connect/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: TRUELAYER_CLIENT_ID!,
        client_secret: TRUELAYER_CLIENT_SECRET!,
        refresh_token: refreshToken,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Update stored token
    await db.query(
      `UPDATE bank_connections
       SET access_token = $1, expires_at = $2, updated_at = NOW()
       WHERE tenant_id = $3 AND provider = 'truelayer'`,
      [access_token, expiresAt, tenantId]
    );

    logger.info('TrueLayer token refreshed', { tenantId });
  } catch (error) {
    logger.error('TrueLayer token refresh failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function syncTrueLayerTransactions(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<number> {
  logger.info('Syncing TrueLayer transactions', { tenantId, startDate, endDate });

  const connection = await db.query<{
    access_token: string;
    account_id: string;
    expires_at: Date | null;
  }>(
    'SELECT access_token, account_id, expires_at FROM bank_connections WHERE tenant_id = $1 AND provider = $2',
    [tenantId, 'truelayer']
  );

  if (connection.rows.length === 0) {
    throw new Error('TrueLayer not connected');
  }

  let { access_token, account_id, expires_at } = connection.rows[0];

  // Refresh token if expired
  if (expires_at && new Date(expires_at) < new Date()) {
    await refreshTrueLayerToken(tenantId);
    const refreshed = await db.query<{ access_token: string }>(
      'SELECT access_token FROM bank_connections WHERE tenant_id = $1 AND provider = $2',
      [tenantId, 'truelayer']
    );
    access_token = refreshed.rows[0].access_token;
  }

  try {
    const response = await axios.get(
      `${TRUELAYER_BASE_URL}/data/v1/accounts/${account_id}/transactions`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
        params: {
          from: startDate.toISOString().split('T')[0],
          to: endDate.toISOString().split('T')[0],
        },
      }
    );

    const transactions = response.data.results || [];
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
            new Date(tx.timestamp),
            Math.abs(tx.amount),
            tx.currency || 'GBP',
            tx.description || 'TrueLayer Transaction',
          ]
        );
        synced++;
      }
    }

    // Update last sync
    await db.query(
      `UPDATE bank_connections
       SET last_sync = NOW(), last_success = NOW(), error_count = 0, updated_at = NOW()
       WHERE tenant_id = $1 AND provider = 'truelayer'`,
      [tenantId]
    );

    logger.info('TrueLayer transactions synced', { tenantId, synced });
    return synced;
  } catch (error) {
    // Record error
    await db.query(
      `UPDATE bank_connections
       SET last_sync = NOW(), error_count = error_count + 1, last_error = $1, updated_at = NOW()
       WHERE tenant_id = $2 AND provider = 'truelayer'`,
      [error instanceof Error ? error.message : 'Sync failed', tenantId]
    );

    logger.error('TrueLayer sync failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
