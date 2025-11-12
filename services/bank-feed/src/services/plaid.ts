// Plaid SDK - using simplified approach for now
// In production, use proper Plaid SDK
const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID || '';
const PLAID_SECRET = process.env.PLAID_SECRET || '';
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';

interface PlaidLinkTokenResponse {
  link_token: string;
}

interface PlaidExchangeResponse {
  access_token: string;
  item_id: string;
}

interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  date: string;
  amount: number;
  name: string;
  merchant_name?: string;
  category?: string[];
  iso_currency_code?: string;
  payment_channel?: string;
}

// PlaidTransactionsResponse interface removed - using inline type
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('bank-feed-service');

const PLAID_BASE_URL = PLAID_ENV === 'production' 
  ? 'https://production.plaid.com'
  : 'https://sandbox.plaid.com';

async function plaidRequest(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${PLAID_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
      'PLAID-SECRET': PLAID_SECRET,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Plaid request failed: ${response.statusText}`);
  }
  return response.json();
}

export async function createLinkToken(userId: string): Promise<string> {
  try {
    const response = await plaidRequest('/link/token/create', {
      user: {
        client_user_id: userId,
      },
      client_name: 'AI Accountant',
      products: ['transactions'],
      country_codes: ['GB'],
      language: 'en',
    }) as PlaidLinkTokenResponse;

    return response.link_token;
  } catch (error) {
    logger.error('Failed to create Plaid link token', error instanceof Error ? error : new Error(String(error)));
    throw new Error('Failed to create Plaid link token');
  }
}

export async function exchangePublicToken(
  publicToken: string,
  tenantId: TenantId
): Promise<{ accessToken: string; itemId: string }> {
  try {
    const response = await plaidRequest('/item/public_token/exchange', {
      public_token: publicToken,
    }) as PlaidExchangeResponse;

    const accessToken = response.access_token || '';
    const itemId = response.item_id || '';
    
    if (!accessToken || !itemId) {
      throw new Error('Invalid response from Plaid');
    }

    // Store access token securely (in production, encrypt this)
    await db.query(
      `INSERT INTO bank_connections (tenant_id, provider, access_token, item_id, is_active)
       VALUES ($1, 'plaid', $2, $3, true)
       ON CONFLICT (tenant_id, item_id) DO UPDATE
       SET access_token = $2, is_active = true, updated_at = NOW()`,
      [tenantId, accessToken, itemId]
    );

    return { accessToken, itemId };
  } catch (error) {
    logger.error('Failed to exchange public token', error instanceof Error ? error : new Error(String(error)));
    throw new Error('Failed to exchange public token');
  }
}

export async function fetchTransactions(
  accessToken: string,
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<void> {
  try {
    const response = await plaidRequest('/transactions/get', {
      access_token: accessToken,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
    }) as { transactions: PlaidTransaction[] };

    const transactions = response.transactions;

    // Store transactions in database
    for (const transaction of transactions) {
      await db.query(
        `INSERT INTO bank_transactions (
          tenant_id, account_id, transaction_id, date, amount, currency, description, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (tenant_id, account_id, transaction_id) DO NOTHING`,
        [
          tenantId,
          transaction.account_id,
          transaction.transaction_id,
          transaction.date,
          transaction.amount,
          transaction.iso_currency_code || 'GBP',
          transaction.name || transaction.merchant_name || '',
          JSON.stringify({
            category: transaction.category || [],
            merchantName: transaction.merchant_name || '',
            paymentChannel: transaction.payment_channel || '',
          }),
        ]
      );
    }

    logger.info('Transactions fetched and stored', { count: transactions.length, tenantId });
  } catch (error) {
    logger.error('Failed to fetch transactions', error instanceof Error ? error : new Error(String(error)));
    throw new Error('Failed to fetch transactions');
  }
}
