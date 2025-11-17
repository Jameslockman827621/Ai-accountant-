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

const logger = createLogger('nordigen-service');

export interface NordigenConfig {
  secretId: string;
  secretKey: string;
  environment: 'sandbox' | 'production';
}

export interface NordigenAccount {
  id: string;
  iban: string;
  name: string;
  currency: string;
  owner_name: string;
  product: string;
}

export interface NordigenTransaction {
  transactionId: string;
  amount: number;
  currency: string;
  bookingDate: string;
  valueDate: string;
  remittanceInformationUnstructured?: string;
  remittanceInformationStructured?: string;
  debtorName?: string;
  creditorName?: string;
  transactionCode?: string;
}

export class NordigenService {
  private baseUrl(environment: 'sandbox' | 'production'): string {
    return environment === 'production'
      ? 'https://ob.nordigen.com'
      : 'https://ob.sandbox.nordigen.com';
  }

  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  /**
   * Authenticate and get access token
   */
  private async authenticate(
    secretId: string,
    secretKey: string,
    environment: 'sandbox' | 'production'
  ): Promise<string> {
    // Check if token is still valid
    if (this.accessToken && this.tokenExpiresAt && this.tokenExpiresAt > new Date()) {
      return this.accessToken;
    }

    const baseUrl = this.baseUrl(environment);
    const response = await fetch(`${baseUrl}/api/v2/token/new/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        secret_id: secretId,
        secret_key: secretKey,
      }),
    });

    if (!response.ok) {
      throw new Error(`Nordigen authentication failed: ${response.statusText}`);
    }

    const data = await response.json();
    this.accessToken = data.access;
    const expiresIn = data.access_expires || 86400; // Default 24 hours
    this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    return this.accessToken;
  }

  /**
   * Create Nordigen connection
   */
  async createConnection(
    tenantId: TenantId,
    secretId: string,
    secretKey: string,
    environment: 'sandbox' | 'production' = 'sandbox'
  ): Promise<string> {
    try {
      // Authenticate
      await this.authenticate(secretId, secretKey, environment);

      // Store connection
      const connectionId = await persistConnectionTokens(tenantId, {
        provider: 'nordigen',
        secretId,
        secretKey,
        environment,
      });

      logger.info('Nordigen connection created', { tenantId, connectionId });

      return connectionId;
    } catch (error) {
      logger.error('Failed to create Nordigen connection', {
        tenantId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Create requisition (bank connection flow)
   */
  async createRequisition(
    tenantId: TenantId,
    connectionId: string,
    institutionId: string,
    redirectUri: string
  ): Promise<{ requisitionId: string; link: string }> {
    const connection = await getConnectionByProviderAccount(tenantId, connectionId);
    if (!connection || connection.provider !== 'nordigen') {
      throw new Error('Connection not found or invalid provider');
    }

    const secrets = await getConnectionSecrets(connection.id);
    const secretId = secrets.secretId as string;
    const secretKey = secrets.secretKey as string;
    const environment = (secrets.environment as 'sandbox' | 'production') || 'sandbox';

    const accessToken = await this.authenticate(secretId, secretKey, environment);
    const baseUrl = this.baseUrl(environment);

    const response = await fetch(`${baseUrl}/api/v2/requisitions/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        institution_id: institutionId,
        redirect: redirectUri,
        reference: `${tenantId}_${connectionId}`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Nordigen requisition creation failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      requisitionId: data.id,
      link: data.link,
    };
  }

  /**
   * Sync transactions from Nordigen
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
      if (!connection || connection.provider !== 'nordigen') {
        throw new Error('Connection not found or invalid provider');
      }

      const secrets = await getConnectionSecrets(connection.id);
      const secretId = secrets.secretId as string;
      const secretKey = secrets.secretKey as string;
      const environment = (secrets.environment as 'sandbox' | 'production') || 'sandbox';

      const accessToken = await this.authenticate(secretId, secretKey, environment);
      const baseUrl = this.baseUrl(environment);

      const endDate = options?.endDate || new Date();
      const startDate = options?.startDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days

      // Fetch accounts if not provided
      let accountIds: string[] = [];
      if (options?.accountId) {
        accountIds = [options.accountId];
      } else {
        // Get accounts from requisition
        const requisitionsResponse = await fetch(`${baseUrl}/api/v2/requisitions/`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (requisitionsResponse.ok) {
          const requisitionsData = await requisitionsResponse.json();
          const requisition = requisitionsData.results?.find(
            (r: any) => r.reference === `${tenantId}_${connectionId}`
          );

          if (requisition?.accounts) {
            accountIds = requisition.accounts;
          }
        }
      }

      // Fetch transactions for each account
      const allTransactions: NordigenTransaction[] = [];

      for (const accountId of accountIds) {
        const transactionsResponse = await fetch(
          `${baseUrl}/api/v2/accounts/${accountId}/transactions/`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (transactionsResponse.ok) {
          const transactionsData = await transactionsResponse.json();
          const transactions = transactionsData.transactions?.booked || [];
          allTransactions.push(...transactions);
        }
      }

      // Filter by date range
      const filteredTransactions = allTransactions.filter((tx) => {
        const bookingDate = new Date(tx.bookingDate);
        return bookingDate >= startDate && bookingDate <= endDate;
      });

      // Store transactions
      let newCount = 0;
      let updatedCount = 0;

      for (const transaction of filteredTransactions) {
        const existing = await db.query<{ id: string }>(
          `SELECT id FROM bank_transactions
           WHERE tenant_id = $1 AND transaction_id = $2`,
          [tenantId, transaction.transactionId]
        );

        const description =
          transaction.remittanceInformationUnstructured ||
          transaction.remittanceInformationStructured ||
          '';

        if (existing.rows.length === 0) {
          await db.query(
            `INSERT INTO bank_transactions (
              tenant_id, account_id, transaction_id, date, amount, currency,
              description, category, metadata, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())`,
            [
              tenantId,
              accountIds[0] || 'unknown',
              transaction.transactionId,
              new Date(transaction.bookingDate),
              transaction.amount,
              transaction.currency,
              description,
              null,
              JSON.stringify({
                valueDate: transaction.valueDate,
                debtorName: transaction.debtorName,
                creditorName: transaction.creditorName,
                transactionCode: transaction.transactionCode,
              }),
            ]
          );
          newCount++;
        } else {
          await db.query(
            `UPDATE bank_transactions
             SET amount = $1, description = $2, metadata = $3::jsonb
             WHERE tenant_id = $4 AND transaction_id = $5`,
            [
              transaction.amount,
              description,
              JSON.stringify({
                valueDate: transaction.valueDate,
                debtorName: transaction.debtorName,
                creditorName: transaction.creditorName,
                transactionCode: transaction.transactionCode,
              }),
              tenantId,
              transaction.transactionId,
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
          'nordigen',
          options?.startDate ? 'differential' : 'full',
          'completed',
          filteredTransactions.length,
          newCount,
          updatedCount,
          duration / 1000,
        ]
      );

      logger.info('Nordigen sync completed', {
        tenantId,
        connectionId,
        transactionCount: filteredTransactions.length,
        newCount,
        updatedCount,
        duration,
      });

      return {
        success: true,
        transactionCount: filteredTransactions.length,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await recordSyncError(connectionId, errorMessage);

      logger.error('Nordigen sync failed', {
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
}

export const nordigenService = new NordigenService();
