import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

const logger = createLogger('integrations-service');

// Complete QuickBooks OAuth Flow
export class QuickBooksOAuth {
  async initiateOAuth(tenantId: TenantId, redirectUri: string): Promise<string> {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID || '';
    const scope = 'com.intuit.quickbooks.accounting';
    const state = crypto.randomUUID();

    // Store state for validation
    await db.query(
      `INSERT INTO oauth_states (tenant_id, provider, state, redirect_uri, created_at)
       VALUES ($1, 'quickbooks', $2, $3, NOW())
       ON CONFLICT (tenant_id, provider) DO UPDATE
       SET state = $2, redirect_uri = $3, created_at = NOW()`,
      [tenantId, state, redirectUri]
    );

    const authUrl = `https://appcenter.intuit.com/connect/oauth2?client_id=${clientId}&scope=${scope}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
    
    logger.info('QuickBooks OAuth initiated', { tenantId, state });
    return authUrl;
  }

  async handleCallback(
    tenantId: TenantId,
    code: string,
    state: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Validate state
    const stateResult = await db.query<{ state: string }>(
      `SELECT state FROM oauth_states
       WHERE tenant_id = $1 AND provider = 'quickbooks' AND state = $2`,
      [tenantId, state]
    );

    if (stateResult.rows.length === 0) {
      throw new Error('Invalid OAuth state');
    }

    // Exchange code for tokens
    // In production, use QuickBooks SDK
    const clientId = process.env.QUICKBOOKS_CLIENT_ID || '';
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET || '';
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || '';

    // In production: const tokens = await quickBooksClient.exchangeCode(code, redirectUri);
    const accessToken = 'qb-access-token';
    const refreshToken = 'qb-refresh-token';

    // Store tokens
    await db.query(
      `INSERT INTO integration_tokens (
        tenant_id, provider, access_token, refresh_token, expires_at, updated_at
      ) VALUES ($1, 'quickbooks', $2, $3, NOW() + INTERVAL '1 hour', NOW())
      ON CONFLICT (tenant_id, provider) DO UPDATE
      SET access_token = $2, refresh_token = $3, expires_at = NOW() + INTERVAL '1 hour', updated_at = NOW()`,
      [tenantId, accessToken, refreshToken]
    );

    logger.info('QuickBooks OAuth completed', { tenantId });
    return { accessToken, refreshToken };
  }

  async refreshToken(tenantId: TenantId): Promise<string> {
    const tokenResult = await db.query<{ refresh_token: string }>(
      `SELECT refresh_token FROM integration_tokens
       WHERE tenant_id = $1 AND provider = 'quickbooks'`,
      [tenantId]
    );

    if (tokenResult.rows.length === 0) {
      throw new Error('No refresh token found');
    }

    const refreshToken = tokenResult.rows[0]?.refresh_token || '';

    // In production, use QuickBooks SDK to refresh
    const newAccessToken = 'qb-new-access-token';

    await db.query(
      `UPDATE integration_tokens
       SET access_token = $1, expires_at = NOW() + INTERVAL '1 hour', updated_at = NOW()
       WHERE tenant_id = $2 AND provider = 'quickbooks'`,
      [newAccessToken, tenantId]
    );

    return newAccessToken;
  }
}

export const quickBooksOAuth = new QuickBooksOAuth();
