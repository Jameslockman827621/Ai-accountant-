import { Configuration, PlaidApi, PlaidEnvironments, TransactionsGetRequest } from 'plaid';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('bank-feed-service');

const configuration = new Configuration({
  basePath: process.env.PLAID_ENV === 'production' 
    ? PlaidEnvironments.production 
    : PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID || '',
      'PLAID-SECRET': process.env.PLAID_SECRET || '',
    },
  },
});

const plaidClient = new PlaidApi(configuration);

export async function createLinkToken(userId: string): Promise<string> {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: {
        client_user_id: userId,
      },
      client_name: 'AI Accountant',
      products: ['transactions'],
      country_codes: ['GB'],
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
    const request: TransactionsGetRequest = {
      access_token: accessToken,
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
    };

    const response = await plaidClient.transactionsGet(request);
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
            category: transaction.category,
            merchantName: transaction.merchant_name,
            paymentChannel: transaction.payment_channel,
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
