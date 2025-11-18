import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import crypto from 'crypto';

const logger = createLogger('integrations-service');

export class XeroIntegration {
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor() {
    this.clientId = process.env.XERO_CLIENT_ID || '';
    this.clientSecret = process.env.XERO_CLIENT_SECRET || '';
  }

  private buildState(tenantId: TenantId): string {
    const secret = this.clientSecret || 'xero-secret';
    return crypto.createHash('sha256').update(`${tenantId}:${secret}`).digest('hex');
  }

  async authenticate(tenantId: TenantId): Promise<string> {
    logger.info('Authenticating with Xero', { tenantId });

    if (!this.clientId) {
      logger.warn('Missing Xero client ID; returning placeholder URL');
    }
    
    const redirectUri = process.env.XERO_REDIRECT_URI || 'http://localhost:3000/integrations/xero/callback';
    return `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${this.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=accounting.transactions%20accounting.contacts&state=${this.buildState(tenantId)}`;
  }

  async syncChartOfAccounts(tenantId: TenantId): Promise<void> {
    logger.info('Syncing Xero chart of accounts', { tenantId, clientConfigured: Boolean(this.clientId) });
  }

  async syncTransactions(tenantId: TenantId, startDate: Date, endDate: Date): Promise<void> {
    logger.info('Syncing Xero transactions', { tenantId, startDate, endDate });
  }
}

export const xeroIntegration = new XeroIntegration();
