import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  CountryCode,
  Products,
  LinkTokenCreateRequest,
} from 'plaid';
import {
  createServiceLogger,
  recordExternalApiCall,
  recordExternalApiError,
  withExponentialBackoff,
} from '@ai-accountant/observability';
import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import {
  getConnectionByProviderAccount,
  getConnectionSecrets,
  markConnectionRefreshed,
  persistConnectionTokens,
} from './connectionStore';
import { recordSyncError, recordSyncSuccess } from './connectionHealth';
import { syncRetryEngine } from './syncRetryEngine';
import { enrichAndPostTransactions, RawBankTransaction } from './transactionEnrichment';
import { handleDuplicateTransaction, isDuplicateTransaction } from './duplicateDetection';

const SERVICE_NAME = 'bank-feed-service';
const logger = createServiceLogger(SERVICE_NAME);

const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID || '';
const PLAID_SECRET = process.env.PLAID_SECRET || '';
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';

const basePath =
  PLAID_ENV === 'production'
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

async function callPlaid<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await withExponentialBackoff(fn, {
      maxAttempts: 3,
      baseDelayMs: 400,
      onRetry: (attempt, error) => {
        logger.warn('Plaid API retry scheduled', {
          operation,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
    recordExternalApiCall('plaid', operation, Date.now() - start, SERVICE_NAME);
    return result;
  } catch (error) {
    recordExternalApiError('plaid', operation, SERVICE_NAME);
    throw error;
  }
}

export async function createLinkToken(userId: string): Promise<string> {
  try {
    const request: LinkTokenCreateRequest = {
      user: {
        client_user_id: userId,
      },
      client_name: 'AI Accountant',
      products: [Products.Transactions],
      country_codes: [CountryCode.Gb],
      language: 'en',
    };

    if (process.env.PLAID_WEBHOOK_URL) {
      request.webhook = process.env.PLAID_WEBHOOK_URL;
    }

      const response = await callPlaid('linkTokenCreate', () => plaidClient.linkTokenCreate(request));

    return response.data.link_token;
  } catch (error) {
    logger.error(
      'Failed to create Plaid link token',
      error instanceof Error ? error : new Error(String(error))
    );
    throw new Error('Failed to create Plaid link token');
  }
}

export async function exchangePublicToken(
  publicToken: string,
  tenantId: TenantId,
  metadata?: Record<string, unknown>
): Promise<{ connectionId: string; itemId: string }> {
  try {
      const response = await callPlaid('itemPublicTokenExchange', () =>
        plaidClient.itemPublicTokenExchange({
          public_token: publicToken,
        })
      );

      const { access_token: accessToken, item_id: itemId } = response.data;
    const connectionId = await persistConnectionTokens({
      tenantId,
      provider: 'plaid',
      accessToken,
      itemId,
        metadata: metadata || undefined,
    });

    return { connectionId, itemId };
  } catch (error) {
    logger.error(
      'Failed to exchange public token',
      error instanceof Error ? error : new Error(String(error))
    );
    throw new Error('Failed to exchange public token');
  }
}

export async function syncPlaidTransactions(
  tenantId: TenantId,
  connectionId: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const secrets = await getConnectionSecrets(connectionId, tenantId);
  try {
      const response = await callPlaid('transactionsGet', () =>
        plaidClient.transactionsGet({
          access_token: secrets.accessToken,
          start_date: startDate.toISOString().split('T')[0],
          end_date: endDate.toISOString().split('T')[0],
          options: {
            include_personal_finance_category: true,
          },
        })
      );

    const transactions = response.data.transactions;
    const newTransactions: RawBankTransaction[] = [];
    for (const transaction of transactions) {
      const description = transaction.name || transaction.merchant_name || '';
      const isDuplicate = await isDuplicateTransaction(
        tenantId,
        transaction.account_id,
        transaction.amount,
        transaction.date,
        description
      );

      if (isDuplicate) {
        await handleDuplicateTransaction(
          tenantId,
          connectionId,
          {
            transactionId: transaction.transaction_id,
            accountId: transaction.account_id,
            date: transaction.date,
            amount: transaction.amount,
            description,
          }
        );
        continue;
      }

      const result = await db.query(
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
          description,
          JSON.stringify({
            category: transaction.category || [],
            merchantName: transaction.merchant_name || '',
            paymentChannel: transaction.payment_channel || '',
            pending: transaction.pending,
          }),
        ]
      );

      if (result.rowCount && result.rowCount > 0) {
        newTransactions.push({
          transactionId: transaction.transaction_id,
          accountId: transaction.account_id,
          amount: transaction.amount,
          currency: transaction.iso_currency_code || 'GBP',
          description,
          date: transaction.date,
          merchantName: transaction.merchant_name || undefined,
          plaidCategory: transaction.category || undefined,
        });
      }
    }

    await enrichAndPostTransactions(tenantId, newTransactions);

      await markConnectionRefreshed(connectionId, {
        accessToken: secrets.accessToken,
      });
      await recordSyncSuccess(tenantId, connectionId);

    logger.info('Plaid transactions synced', {
      tenantId,
      connectionId,
      count: transactions.length,
    });

    return transactions.length;
  } catch (error) {
      const errObj = error instanceof Error ? error : new Error(String(error));
      await recordSyncError(tenantId, connectionId, errObj.message);
      
      // Schedule automatic retry
      try {
        await syncRetryEngine.scheduleRetry(tenantId, connectionId, errObj.message);
        logger.info('Sync retry scheduled', { tenantId, connectionId });
      } catch (retryError) {
        logger.warn('Failed to schedule sync retry', {
          tenantId,
          connectionId,
          error: retryError instanceof Error ? retryError : new Error(String(retryError)),
        });
      }
      
      logger.error('Failed to sync Plaid transactions', errObj, {
        tenantId,
        connectionId,
      });
      throw new Error('Failed to fetch transactions');
  }
}

interface PlaidWebhookPayload {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  environment: string;
}

export async function handlePlaidWebhook(
  payload: PlaidWebhookPayload
): Promise<void> {
  if (payload.webhook_type !== 'TRANSACTIONS') {
    logger.debug('Ignoring non-transaction Plaid webhook', { payload });
    return;
  }

  const connection = await getConnectionByProviderAccount('plaid', payload.item_id);
  if (!connection) {
    logger.warn('Received Plaid webhook for unknown item', {
      itemId: payload.item_id,
    });
    return;
  }

  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 5);

  await syncPlaidTransactions(connection.tenantId, connection.connectionId, start, now);
}
