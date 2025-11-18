import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import crypto from 'crypto';

const logger = createLogger('integrations-service');

interface QuickBooksTokenResponse {
  access_token?: string | undefined;
  refresh_token?: string | undefined;
  expires_in?: number | undefined;
  realmId?: string | undefined;
}

function parseQuickBooksTokenResponse(payload: unknown): QuickBooksTokenResponse {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const record = payload as Record<string, unknown>;
  const getString = (key: string): string | undefined => {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
  };

  const getNumber = (key: string): number | undefined => {
    const value = record[key];
    return typeof value === 'number' ? value : undefined;
  };

  return {
    access_token: getString('access_token'),
    refresh_token: getString('refresh_token'),
    expires_in: getNumber('expires_in'),
    realmId: getString('realmId') || getString('realm_id'),
  };
}

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
    const clientId = process.env.QUICKBOOKS_CLIENT_ID || '';
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET || '';
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || '';

    const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`QuickBooks token exchange failed: ${tokenResponse.status} ${errorText}`);
    }

    const tokenData = parseQuickBooksTokenResponse(await tokenResponse.json());
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const realmId = tokenData.realmId; // QuickBooks company ID

    if (!accessToken || !refreshToken || !realmId) {
      throw new Error('QuickBooks token exchange returned incomplete data');
    }

    // Store tokens and realm ID
    const expiresInMs = (tokenData.expires_in ?? 3600) * 1000;
    const expiresAt = new Date(Date.now() + expiresInMs);
    
    await db.query(
      `INSERT INTO quickbooks_connections (
        tenant_id, access_token, refresh_token, realm_id, expires_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (tenant_id) DO UPDATE
      SET access_token = $2, refresh_token = $3, realm_id = $4, expires_at = $5, updated_at = NOW()`,
      [tenantId, accessToken, refreshToken, realmId, expiresAt]
    );

    logger.info('QuickBooks OAuth completed', { tenantId, realmId });
    return { accessToken, refreshToken };
  }

  async refreshToken(tenantId: TenantId): Promise<string> {
    const tokenResult = await db.query<{ refresh_token: string }>(
      `SELECT refresh_token FROM quickbooks_connections WHERE tenant_id = $1`,
      [tenantId]
    );

    if (tokenResult.rows.length === 0) {
      throw new Error('No refresh token found');
    }

    const refreshToken = tokenResult.rows[0]?.refresh_token || '';
    const clientId = process.env.QUICKBOOKS_CLIENT_ID || '';
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET || '';

    const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`QuickBooks token refresh failed: ${tokenResponse.status} ${errorText}`);
    }

    const tokenData = parseQuickBooksTokenResponse(await tokenResponse.json());
    const newAccessToken = tokenData.access_token;
    const newRefreshToken = tokenData.refresh_token || refreshToken;
    const expiresInMs = (tokenData.expires_in ?? 3600) * 1000;
    const expiresAt = new Date(Date.now() + expiresInMs);

    if (!newAccessToken) {
      throw new Error('QuickBooks token refresh returned no access token');
    }

    await db.query(
      `UPDATE quickbooks_connections
       SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW()
       WHERE tenant_id = $4`,
      [newAccessToken, newRefreshToken, expiresAt, tenantId]
    );

    logger.info('QuickBooks token refreshed', { tenantId });
    return newAccessToken;
  }
}

export const quickBooksOAuth = new QuickBooksOAuth();
