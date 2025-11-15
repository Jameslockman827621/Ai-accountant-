import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import {
  getConnectionByProviderAccount,
  getConnectionSecrets,
  markConnectionRefreshed,
  persistConnectionTokens,
} from './connectionStore';
import { recordSyncError, recordSyncSuccess } from './connectionHealth';

const logger = createLogger('bank-feed-service');

const TRUELAYER_CLIENT_ID = process.env.TRUELAYER_CLIENT_ID || '';
const TRUELAYER_CLIENT_SECRET = process.env.TRUELAYER_CLIENT_SECRET || '';
const TRUELAYER_ENV = process.env.TRUELAYER_ENV || 'sandbox';

const TRUELAYER_BASE_URL =
  TRUELAYER_ENV === 'production'
    ? 'https://api.truelayer.com'
    : 'https://api.truelayer-sandbox.com';

interface TrueLayerTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

interface TrueLayerAccount {
  account_id: string;
  account_type: string;
  display_name: string;
  currency: string;
  account_number?: {
    number: string;
    sort_code: string;
  };
}

interface TrueLayerTransaction {
  transaction_id: string;
  timestamp: string;
  description: string;
  transaction_type: string;
  transaction_category: string;
  amount: number;
  currency: string;
  merchant_name?: string;
}

async function trueLayerRequest(
  endpoint: string,
  method: string = 'GET',
  accessToken?: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  } else {
    const credentials = Buffer.from(
      `${TRUELAYER_CLIENT_ID}:${TRUELAYER_CLIENT_SECRET}`
    ).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(`${TRUELAYER_BASE_URL}${endpoint}`, fetchOptions);

  if (!response.ok) {
    throw new Error(`TrueLayer request failed: ${response.statusText}`);
  }

  return response.json();
}

export async function createTrueLayerAuthLink(
  _userId: string,
  redirectUri: string,
  state: string
): Promise<string> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: TRUELAYER_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'accounts transactions offline_access',
    providers: 'uk-domestic-accounts',
    state,
  });

  return `${TRUELAYER_BASE_URL.replace('api.', '')}/?${params.toString()}`;
}

export async function exchangeTrueLayerCode(
  code: string,
  redirectUri: string,
  tenantId: TenantId
): Promise<{ connectionId: string; accounts: TrueLayerAccount[] }> {
  try {
    const response = (await trueLayerRequest(
      '/connect/token',
      'POST',
      undefined,
      {
        grant_type: 'authorization_code',
        client_id: TRUELAYER_CLIENT_ID,
        client_secret: TRUELAYER_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }
    )) as TrueLayerTokenResponse;

    const accountsResponse = (await trueLayerRequest(
      '/data/v1/accounts',
      'GET',
      response.access_token
    )) as { results: TrueLayerAccount[] };

    const providerId = accountsResponse.results[0]?.account_id || 'unknown';
    const tokenExpiresAt = new Date(Date.now() + response.expires_in * 1000);

    const connectionId = await persistConnectionTokens({
      tenantId,
      provider: 'truelayer',
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      providerAccountId: providerId,
      metadata: { accounts: accountsResponse.results },
      tokenExpiresAt,
    });

    return {
      connectionId,
      accounts: accountsResponse.results,
    };
  } catch (error) {
    logger.error(
      'Failed to exchange TrueLayer code',
      error instanceof Error ? error : new Error(String(error))
    );
    throw new Error('Failed to exchange TrueLayer code');
  }
}

export async function refreshTrueLayerConnection(
  connectionId: string,
  tenantId: TenantId
): Promise<void> {
  const secrets = await getConnectionSecrets(connectionId, tenantId);
  if (!secrets.refreshToken) {
    return;
  }

  const response = (await trueLayerRequest(
    '/connect/token',
    'POST',
    undefined,
    {
      grant_type: 'refresh_token',
      client_id: TRUELAYER_CLIENT_ID,
      client_secret: TRUELAYER_CLIENT_SECRET,
      refresh_token: secrets.refreshToken,
    }
  )) as TrueLayerTokenResponse;

  const tokenExpiresAt = new Date(Date.now() + response.expires_in * 1000);
  await markConnectionRefreshed(connectionId, {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    tokenExpiresAt,
  });
}

export async function fetchTrueLayerTransactions(
  connectionId: string,
  tenantId: TenantId,
  accountId: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const secrets = await getConnectionSecrets(connectionId, tenantId);
  try {
    const response = (await trueLayerRequest(
      `/data/v1/accounts/${accountId}/transactions?from=${
        startDate.toISOString().split('T')[0]
      }&to=${endDate.toISOString().split('T')[0]}`,
      'GET',
      secrets.accessToken
    )) as { results: TrueLayerTransaction[] };

    const transactions = response.results;
    for (const transaction of transactions) {
      await db.query(
        `INSERT INTO bank_transactions (
          tenant_id, account_id, transaction_id, date, amount, currency,
          description, category, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (tenant_id, transaction_id) DO NOTHING`,
        [
          tenantId,
          accountId,
          transaction.transaction_id,
          transaction.timestamp.split('T')[0],
          Math.abs(transaction.amount),
          transaction.currency || 'GBP',
          transaction.description,
          transaction.transaction_category,
          JSON.stringify({
            merchantName: transaction.merchant_name || '',
            transactionType: transaction.transaction_type,
          }),
        ]
      );
    }

    await markConnectionRefreshed(connectionId, {
      accessToken: secrets.accessToken,
      refreshToken: secrets.refreshToken ?? null,
      tokenExpiresAt: secrets.tokenExpiresAt || undefined,
    });
    await recordSyncSuccess(tenantId, connectionId);

    logger.info('TrueLayer transactions fetched and stored', {
      count: transactions.length,
      tenantId,
      connectionId,
    });
    return transactions.length;
  } catch (error) {
    const errObj = error instanceof Error ? error : new Error(String(error));
    await recordSyncError(tenantId, connectionId, errObj.message);
    logger.error('Failed to fetch TrueLayer transactions', errObj, {
      tenantId,
      connectionId,
    });
    throw errObj;
  }
}

interface TrueLayerWebhookPayload {
  event_name: string;
  resource_id: string;
  resource_type: string;
  account_id: string;
}

export async function handleTrueLayerWebhook(
  payload: TrueLayerWebhookPayload
): Promise<void> {
  if (payload.resource_type !== 'transaction') {
    return;
  }

  const connection = await getConnectionByProviderAccount(
    'truelayer',
    payload.account_id
  );
  if (!connection) {
    logger.warn('TrueLayer webhook for unknown account', payload);
    return;
  }

  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 5);

  await fetchTrueLayerTransactions(
    connection.connectionId,
    connection.tenantId,
    payload.account_id,
    start,
    now
  );
}
