import { Configuration, PlaidApi, PlaidEnvironments, CountryCode, Products } from 'plaid';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('bank-feed-service');

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID || '';
const PLAID_SECRET = process.env.PLAID_SECRET || '';
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';

const basePath: string = PLAID_ENV === 'production' 
  ? PlaidEnvironments.production 
  : PlaidEnvironments.sandbox;

const configuration = new Configuration({
  basePath: basePath as string,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
      'PLAID-SECRET': PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);

export async function createLinkToken(userId: string): Promise<string> {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: userId,
      },
      client_name: 'AI Accountant',
      products: [Products.Transactions],
      country_codes: [CountryCode.Gb],
      language: 'en',
    });

    return response.data.link_token;
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
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;

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
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    if (!startDateStr || !endDateStr) {
      throw new Error('Invalid date format');
    }
    
    const response = await plaidClient.transactionsGet({
      access_token: accessToken,
      start_date: startDateStr,
      end_date: endDateStr,
    });

    const transactions = response.data.transactions;

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
