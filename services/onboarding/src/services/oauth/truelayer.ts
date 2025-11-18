import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('truelayer-oauth');

export interface TrueLayerConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: 'sandbox' | 'live';
}

export interface TrueLayerAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface TrueLayerAccount {
  account_id: string;
  account_type: string;
  display_name: string;
  currency: string;
  account_number?: {
    iban?: string;
    number?: string;
    sort_code?: string;
  };
  provider: {
    display_name: string;
    provider_id: string;
  };
}

interface TrueLayerErrorResponse {
  error?: string;
  error_description?: string;
}

interface TrueLayerAccountsResponse {
  results?: TrueLayerAccount[];
}

interface TrueLayerTransactionsResponse {
  results?: Array<Record<string, unknown>>;
}

function formatTrueLayerError(error: TrueLayerErrorResponse): string {
  return error.error_description || error.error || 'Unknown error';
}

export class TrueLayerOAuthService {
  private config: TrueLayerConfig;
  private baseUrl: string;
  private tokenUrl: string;

  constructor(config: TrueLayerConfig) {
    this.config = config;
    this.baseUrl = config.environment === 'live' 
      ? 'https://api.truelayer.com' 
      : 'https://api.truelayer-sandbox.com';
    this.tokenUrl = config.environment === 'live'
      ? 'https://auth.truelayer.com'
      : 'https://auth.truelayer-sandbox.com';
  }

  /**
   * Generate authorization URL for OAuth flow
   */
  generateAuthorizationUrl(state: string, scopes: string[] = ['accounts', 'transactions']): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: scopes.join(' '),
      state,
      nonce: crypto.randomUUID(),
    });

    return `${this.tokenUrl}/connect/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code: string): Promise<TrueLayerAuthResponse> {
    try {
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString('base64');

      const response = await fetch(`${this.tokenUrl}/connect/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.config.redirectUri,
        }),
      });

        if (!response.ok) {
          const errorBody = (await response.json()) as TrueLayerErrorResponse;
          throw new Error(`TrueLayer API error: ${formatTrueLayerError(errorBody)}`);
        }

        const data = (await response.json()) as TrueLayerAuthResponse;
        logger.info('TrueLayer token exchanged', { scope: data.scope });

        return data;
    } catch (error) {
      logger.error('Failed to exchange TrueLayer code', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<TrueLayerAuthResponse> {
    try {
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`
      ).toString('base64');

      const response = await fetch(`${this.tokenUrl}/connect/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

        if (!response.ok) {
          const errorBody = (await response.json()) as TrueLayerErrorResponse;
          throw new Error(`TrueLayer API error: ${formatTrueLayerError(errorBody)}`);
        }

        const data = (await response.json()) as TrueLayerAuthResponse;
        logger.info('TrueLayer token refreshed');

        return data;
    } catch (error) {
      logger.error('Failed to refresh TrueLayer token', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get user accounts
   */
  async getAccounts(accessToken: string): Promise<TrueLayerAccount[]> {
    try {
      const response = await fetch(`${this.baseUrl}/data/v1/accounts`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

        if (!response.ok) {
          const errorBody = (await response.json()) as TrueLayerErrorResponse;
          throw new Error(`TrueLayer API error: ${formatTrueLayerError(errorBody)}`);
        }

        const data = (await response.json()) as TrueLayerAccountsResponse;
        return data.results || [];
    } catch (error) {
      logger.error('Failed to get TrueLayer accounts', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get transactions for an account
   */
  async getTransactions(
    accessToken: string,
    accountId: string,
    from?: string,
    to?: string
  ): Promise<any[]> {
    try {
      const params = new URLSearchParams();
      if (from) params.append('from', from);
      if (to) params.append('to', to);

      const response = await fetch(
        `${this.baseUrl}/data/v1/accounts/${accountId}/transactions?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

        if (!response.ok) {
          const errorBody = (await response.json()) as TrueLayerErrorResponse;
          throw new Error(`TrueLayer API error: ${formatTrueLayerError(errorBody)}`);
        }

        const data = (await response.json()) as TrueLayerTransactionsResponse;
        return data.results || [];
    } catch (error) {
      logger.error('Failed to get TrueLayer transactions', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Handle webhook from TrueLayer
   */
  async handleWebhook(webhookData: {
    event_type: string;
    event_id: string;
    timestamp: string;
    [key: string]: unknown;
  }): Promise<void> {
    logger.info('TrueLayer webhook received', {
      eventType: webhookData.event_type,
      eventId: webhookData.event_id,
    });

    // Handle different event types
    switch (webhookData.event_type) {
      case 'transaction_created':
      case 'transaction_updated':
        logger.info('Transaction event', { eventId: webhookData.event_id });
        // Trigger transaction sync
        break;

      case 'account_updated':
        logger.info('Account updated', { eventId: webhookData.event_id });
        // Update account information
        break;

      default:
        logger.warn('Unknown TrueLayer event type', { eventType: webhookData.event_type });
    }
  }
}

export function createTrueLayerService(config: TrueLayerConfig): TrueLayerOAuthService {
  return new TrueLayerOAuthService(config);
}
