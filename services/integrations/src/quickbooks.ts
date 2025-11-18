import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import crypto from 'crypto';

const logger = createLogger('integrations-service');

export class QuickBooksIntegration {
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor() {
    this.clientId = process.env.QUICKBOOKS_CLIENT_ID || '';
    this.clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET || '';
  }

  private buildState(tenantId: TenantId): string {
    const secret = this.clientSecret || 'quickbooks-secret';
    return crypto.createHash('sha256').update(`${tenantId}:${secret}`).digest('hex');
  }

  async authenticate(tenantId: TenantId): Promise<string> {
    logger.info('Authenticating with QuickBooks', { tenantId });

    if (!this.clientId) {
      logger.warn('Missing QuickBooks client ID; returning placeholder URL');
    }

    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || 'http://localhost:3000/integrations/quickbooks/callback';
    const authUrl = `https://appcenter.intuit.com/connect/oauth2?client_id=${this.clientId}&scope=com.intuit.quickbooks.accounting&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${this.buildState(tenantId)}`;
    
    return authUrl;
  }

  async syncChartOfAccounts(tenantId: TenantId): Promise<void> {
    logger.info('Syncing QuickBooks chart of accounts', { tenantId, clientConfigured: Boolean(this.clientId) });
    // Stub implementation: real API call handled in services/quickbooks.ts
  }

  async syncTransactions(tenantId: TenantId, startDate: Date, endDate: Date): Promise<void> {
    logger.info('Syncing QuickBooks transactions', { tenantId, startDate, endDate });
    // Stub implementation: real API call handled in services/quickbooks.ts
  }
}

export const quickBooksIntegration = new QuickBooksIntegration();
