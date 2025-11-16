import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('plaid-oauth');

export interface PlaidConfig {
  clientId: string;
  secret: string;
  environment: 'sandbox' | 'development' | 'production';
  redirectUri: string;
}

export interface PlaidLinkTokenResponse {
  link_token: string;
  expiration: string;
  request_id: string;
}

export interface PlaidExchangeTokenResponse {
  access_token: string;
  item_id: string;
  request_id: string;
}

export class PlaidOAuthService {
  private config: PlaidConfig;
  private baseUrl: string;

  constructor(config: PlaidConfig) {
    this.config = config;
    this.baseUrl =
      config.environment === 'production'
        ? 'https://production.plaid.com'
        : 'https://sandbox.plaid.com';
  }

  /**
   * Create a Link token for Plaid Link initialization
   */
  async createLinkToken(
    tenantId: TenantId,
    userId: UserId,
    products: string[] = ['transactions']
  ): Promise<PlaidLinkTokenResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/link/token/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.config.clientId,
          secret: this.config.secret,
          client_name: 'AI Accountant',
          products,
          country_codes: ['US', 'CA', 'GB'],
          language: 'en',
          user: {
            client_user_id: `${tenantId}_${userId}`,
          },
          webhook: `${process.env.API_BASE_URL}/api/connectors/plaid/webhook`,
          redirect_uri: this.config.redirectUri,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Plaid API error: ${error.error_message || 'Unknown error'}`);
      }

      const data = await response.json();
      logger.info('Plaid link token created', { tenantId, userId, requestId: data.request_id });

      return data;
    } catch (error) {
      logger.error('Failed to create Plaid link token', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Exchange public token for access token
   */
  async exchangePublicToken(publicToken: string): Promise<PlaidExchangeTokenResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/item/public_token/exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.config.clientId,
          secret: this.config.secret,
          public_token: publicToken,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Plaid API error: ${error.error_message || 'Unknown error'}`);
      }

      const data = await response.json();
      logger.info('Plaid public token exchanged', { requestId: data.request_id });

      return data;
    } catch (error) {
      logger.error('Failed to exchange Plaid public token', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get accounts for an item
   */
  async getAccounts(accessToken: string): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/accounts/get`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.config.clientId,
          secret: this.config.secret,
          access_token: accessToken,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Plaid API error: ${error.error_message || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.accounts || [];
    } catch (error) {
      logger.error('Failed to get Plaid accounts', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get transactions for an account
   */
  async getTransactions(
    accessToken: string,
    startDate: string,
    endDate: string,
    accountIds?: string[]
  ): Promise<any[]> {
    try {
      const response = await fetch(`${this.baseUrl}/transactions/get`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.config.clientId,
          secret: this.config.secret,
          access_token: accessToken,
          start_date: startDate,
          end_date: endDate,
          account_ids: accountIds,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Plaid API error: ${error.error_message || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.transactions || [];
    } catch (error) {
      logger.error('Failed to get Plaid transactions', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Handle webhook from Plaid
   */
  async handleWebhook(webhookData: {
    webhook_type: string;
    webhook_code: string;
    item_id: string;
    [key: string]: unknown;
  }): Promise<void> {
    logger.info('Plaid webhook received', {
      webhookType: webhookData.webhook_type,
      webhookCode: webhookData.webhook_code,
      itemId: webhookData.item_id,
    });

    // Handle different webhook types
    switch (webhookData.webhook_type) {
      case 'TRANSACTIONS':
        if (webhookData.webhook_code === 'SYNC_UPDATES_AVAILABLE') {
          // New transactions available - trigger sync
          logger.info('New transactions available', { itemId: webhookData.item_id });
        }
        break;

      case 'ITEM':
        if (webhookData.webhook_code === 'ERROR') {
          logger.error('Plaid item error', { itemId: webhookData.item_id, error: webhookData });
        }
        break;

      default:
        logger.warn('Unknown Plaid webhook type', { webhookType: webhookData.webhook_type });
    }
  }
}

export function createPlaidService(config: PlaidConfig): PlaidOAuthService {
  return new PlaidOAuthService(config);
}
