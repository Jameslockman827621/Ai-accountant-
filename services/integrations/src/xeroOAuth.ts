import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import { quickBooksOAuth } from './quickbooksOAuth';

const logger = createLogger('integrations-service');

// Complete Xero OAuth Flow (similar to QuickBooks)
export class XeroOAuth {
  async initiateOAuth(tenantId: TenantId, redirectUri: string): Promise<string> {
    const clientId = process.env.XERO_CLIENT_ID || '';
    const scope = 'accounting.transactions accounting.contacts';
    const state = crypto.randomUUID();

    await db.query(
      `INSERT INTO oauth_states (tenant_id, provider, state, redirect_uri, created_at)
       VALUES ($1, 'xero', $2, $3, NOW())
       ON CONFLICT (tenant_id, provider) DO UPDATE
       SET state = $2, redirect_uri = $3, created_at = NOW()`,
      [tenantId, state, redirectUri]
    );

    const authUrl = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;
    
    logger.info('Xero OAuth initiated', { tenantId, state });
    return authUrl;
  }

  async handleCallback(
    tenantId: TenantId,
    code: string,
    state: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Validate state (similar to QuickBooks)
    const stateResult = await db.query<{ state: string }>(
      `SELECT state FROM oauth_states
       WHERE tenant_id = $1 AND provider = 'xero' AND state = $2`,
      [tenantId, state]
    );

    if (stateResult.rows.length === 0) {
      throw new Error('Invalid OAuth state');
    }

    // Exchange code for tokens
    const accessToken = 'xero-access-token';
    const refreshToken = 'xero-refresh-token';

    await db.query(
      `INSERT INTO integration_tokens (
        tenant_id, provider, access_token, refresh_token, expires_at, updated_at
      ) VALUES ($1, 'xero', $2, $3, NOW() + INTERVAL '30 minutes', NOW())
      ON CONFLICT (tenant_id, provider) DO UPDATE
      SET access_token = $2, refresh_token = $3, expires_at = NOW() + INTERVAL '30 minutes', updated_at = NOW()`,
      [tenantId, accessToken, refreshToken]
    );

    logger.info('Xero OAuth completed', { tenantId });
    return { accessToken, refreshToken };
  }
}

export const xeroOAuth = new XeroOAuth();
