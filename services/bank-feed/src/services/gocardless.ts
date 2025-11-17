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

const logger = createLogger('gocardless-service');

export interface GoCardlessConfig {
  accessToken: string;
  environment: 'sandbox' | 'live';
}

export interface GoCardlessAccount {
  id: string;
  account_holder_name: string;
  account_number_ending: string;
  bank_name: string;
  account_type: string;
  currency: string;
}

export interface GoCardlessTransaction {
  id: string;
  amount: number;
  currency: string;
  description: string;
  transaction_type: string;
  value_date: string;
  booking_date: string;
  merchant_name?: string;
  category?: string;
}

export class GoCardlessService {
  private baseUrl(environment: 'sandbox' | 'live'): string {
    return environment === 'live'
      ? 'https://api.gocardless.com'
      : 'https://api-sandbox.gocardless.com';
  }

  /**
   * Create GoCardless connection
   */
  async createConnection(
    tenantId: TenantId,
    accessToken: string,
    environment: 'sandbox' | 'live' = 'sandbox'
  ): Promise<string> {
    try {
      // Fetch accounts to verify connection
      const accounts = await this.fetchAccounts(accessToken, environment);

      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }

      // Store connection
      const connectionId = await persistConnectionTokens(tenantId, {
        provider: 'gocardless',
        accessToken,
        environment,
        accounts: accounts.map((acc) => ({
          accountId: acc.id,
          accountName: acc.account_holder_name,
          accountNumber: acc.account_number_ending,
          bankName: acc.bank_name,
          accountType: acc.account_type,
          currency: acc.currency,
        })),
      });

      logger.info('GoCardless connection created', { tenantId, connectionId });

      return connectionId;
    } catch (error) {
      logger.error('Failed to create GoCardless connection', {
        tenantId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Fetch accounts from GoCardless
   */
  async fetchAccounts(
    accessToken: string,
    environment: 'sandbox' | 'live'
  ): Promise<GoCardlessAccount[]> {
    const baseUrl = this.baseUrl(environment);
    const response = await fetch(`${baseUrl}/bank_accounts`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'GoCardless-Version': '2015-07-06',
      },
    });

    if (!response.ok) {
      throw new Error(`GoCardless API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.bank_accounts || [];
  }

  /**
   * Sync transactions from GoCardless
   */
  async syncTransactions(
    tenantId: TenantId,
    connectionId: string,
    options?: {
      startDate?: Date;
      endDate?: Date;
      accountId?: string;
    }
  ): Promise<{ success: boolean; transactionCount: number; error?: string }> {
    const startTime = Date.now();

    try {
      const connection = await getConnectionByProviderAccount(tenantId, connectionId);
      if (!connection || connection.provider !== 'gocardless') {
        throw new Error('Connection not found or invalid provider');
      }

      const secrets = await getConnectionSecrets(connection.id);
      const accessToken = secrets.accessToken as string;
      const environment = (secrets.environment as 'sandbox' | 'live') || 'sandbox';

      const endDate = options?.endDate || new Date();
      const startDate = options?.startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days

      // Fetch transactions
      const transactions = await this.fetchTransactions(
        accessToken,
        environment,
        startDate,
        endDate,
        options?.accountId
      );

      // Store transactions
      let newCount = 0;
      let updatedCount = 0;

      for (const transaction of transactions) {
        const existing = await db.query<{ id: string }>(
          `SELECT id FROM bank_transactions
           WHERE tenant_id = $1 AND transaction_id = $2`,
          [tenantId, transaction.id]
        );

        if (existing.rows.length === 0) {
          await db.query(
            `INSERT INTO bank_transactions (
              tenant_id, account_id, transaction_id, date, amount, currency,
              description, category, metadata, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())`,
            [
              tenantId,
              transaction.id.split('_')[0], // Extract account ID
              transaction.id,
              new Date(transaction.booking_date),
              transaction.amount,
              transaction.currency,
              transaction.description,
              transaction.category || null,
              JSON.stringify({
                transaction_type: transaction.transaction_type,
                merchant_name: transaction.merchant_name,
                value_date: transaction.value_date,
              }),
            ]
          );
          newCount++;
        } else {
          await db.query(
            `UPDATE bank_transactions
             SET amount = $1, description = $2, category = $3, metadata = $4::jsonb
             WHERE tenant_id = $5 AND transaction_id = $6`,
            [
              transaction.amount,
              transaction.description,
              transaction.category || null,
              JSON.stringify({
                transaction_type: transaction.transaction_type,
                merchant_name: transaction.merchant_name,
                value_date: transaction.value_date,
              }),
              tenantId,
              transaction.id,
            ]
          );
          updatedCount++;
        }
      }

      const duration = Date.now() - startTime;

      // Record sync success
      await recordSyncSuccess(connection.id, duration, newCount + updatedCount);

      // Log sync audit
      await db.query(
        `INSERT INTO bank_sync_audit (
          tenant_id, connection_id, provider, sync_type, sync_status,
          transaction_count, new_transactions, updated_transactions,
          latency_seconds, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          tenantId,
          connection.id,
          'gocardless',
          options?.startDate ? 'differential' : 'full',
          'completed',
          transactions.length,
          newCount,
          updatedCount,
          duration / 1000,
        ]
      );

      logger.info('GoCardless sync completed', {
        tenantId,
        connectionId,
        transactionCount: transactions.length,
        newCount,
        updatedCount,
        duration,
      });

      return {
        success: true,
        transactionCount: transactions.length,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await recordSyncError(connectionId, errorMessage);

      logger.error('GoCardless sync failed', {
        tenantId,
        connectionId,
        error: errorMessage,
        duration,
      });

      return {
        success: false,
        transactionCount: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Fetch transactions from GoCardless
   */
  private async fetchTransactions(
    accessToken: string,
    environment: 'sandbox' | 'live',
    startDate: Date,
    endDate: Date,
    accountId?: string
  ): Promise<GoCardlessTransaction[]> {
    const baseUrl = this.baseUrl(environment);
    const params = new URLSearchParams({
      from: startDate.toISOString().split('T')[0],
      to: endDate.toISOString().split('T')[0],
    });

    if (accountId) {
      params.append('bank_account', accountId);
    }

    const response = await fetch(`${baseUrl}/transactions?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'GoCardless-Version': '2015-07-06',
      },
    });

    if (!response.ok) {
      throw new Error(`GoCardless API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.transactions || [];
  }

  /**
   * Refresh access token
   */
  async refreshToken(connectionId: string): Promise<string> {
    // GoCardless uses long-lived tokens, but we can refresh if needed
    // In production, would implement actual token refresh logic
    logger.info('GoCardless token refresh', { connectionId });
    return 'refreshed_token';
  }
}

export const goCardlessService = new GoCardlessService();
