import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('bank-feed-service');

const TRUELAYER_CLIENT_ID = process.env.TRUELAYER_CLIENT_ID || '';
const TRUELAYER_CLIENT_SECRET = process.env.TRUELAYER_CLIENT_SECRET || '';
const TRUELAYER_ENV = process.env.TRUELAYER_ENV || 'sandbox';

const TRUELAYER_BASE_URL = TRUELAYER_ENV === 'production'
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
    // For token requests, use basic auth
    const credentials = Buffer.from(`${TRUELAYER_CLIENT_ID}:${TRUELAYER_CLIENT_SECRET}`).toString('base64');
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

export async function createTrueLayerAuthLink(_userId: string, redirectUri: string): Promise<string> {
  try {
    const response = await trueLayerRequest(
      '/connect/token',
      'POST',
      undefined,
      {
        grant_type: 'authorization_code',
        client_id: TRUELAYER_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'accounts transactions',
        nonce: crypto.randomUUID(),
      }
    ) as { auth_url: string };

    return response.auth_url;
  } catch (error) {
    logger.error('Failed to create TrueLayer auth link', error instanceof Error ? error : new Error(String(error)));
    throw new Error('Failed to create TrueLayer auth link');
  }
}

export async function exchangeTrueLayerCode(
  code: string,
  redirectUri: string,
  tenantId: TenantId
): Promise<{ accessToken: string; refreshToken: string; providerId: string }> {
  try {
    const response = await trueLayerRequest(
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
    ) as TrueLayerTokenResponse;

    // Get provider info
    const accountsResponse = await trueLayerRequest(
      '/data/v1/accounts',
      'GET',
      response.access_token
    ) as { results: TrueLayerAccount[] };

    const providerId = accountsResponse.results[0]?.account_id || 'unknown';

    // Store access token securely (in production, encrypt this)
    await db.query(
      `INSERT INTO bank_connections (tenant_id, provider, access_token, item_id, is_active, metadata)
       VALUES ($1, 'truelayer', $2, $3, true, $4)
       ON CONFLICT (tenant_id, provider, item_id) 
       DO UPDATE SET access_token = $2, updated_at = NOW()`,
      [
        tenantId,
        response.access_token,
        providerId,
        JSON.stringify({
          refresh_token: response.refresh_token,
          expires_in: response.expires_in,
        }),
      ]
    );

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      providerId,
    };
  } catch (error) {
    logger.error('Failed to exchange TrueLayer code', error instanceof Error ? error : new Error(String(error)));
    throw new Error('Failed to exchange TrueLayer code');
  }
}

export async function fetchTrueLayerTransactions(
  accessToken: string,
  tenantId: TenantId,
  accountId: string,
  startDate: Date,
  endDate: Date
): Promise<void> {
  try {
    const response = await trueLayerRequest(
      `/data/v1/accounts/${accountId}/transactions?from=${startDate.toISOString().split('T')[0]}&to=${endDate.toISOString().split('T')[0]}`,
      'GET',
      accessToken
    ) as { results: TrueLayerTransaction[] };

    const transactions = response.results;

    // Store transactions in database
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
          Math.abs(transaction.amount), // TrueLayer uses negative for debits
          transaction.currency || 'GBP',
          transaction.description,
          JSON.stringify({
            category: transaction.transaction_category,
            merchantName: transaction.merchant_name || '',
            transactionType: transaction.transaction_type,
          }),
        ]
      );
    }

    logger.info('TrueLayer transactions fetched and stored', { count: transactions.length, tenantId });
  } catch (error) {
    logger.error('Failed to fetch TrueLayer transactions', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
