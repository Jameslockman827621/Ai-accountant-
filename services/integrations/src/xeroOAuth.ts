import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import crypto from 'crypto';

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
    const clientId = process.env.XERO_CLIENT_ID || '';
    const clientSecret = process.env.XERO_CLIENT_SECRET || '';
    const redirectUri = process.env.XERO_REDIRECT_URI || '';

    const tokenResponse = await fetch('https://identity.xero.com/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`Xero token exchange failed: ${tokenResponse.status} ${errorText}`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    const refreshToken = tokenData.refresh_token;
    const tenantIdXero = tokenData.tenant_id || tokenData.tenantId; // Xero tenant ID

    // Store tokens and tenant ID
    const expiresAt = new Date(Date.now() + (tokenData.expires_in * 1000));
    
    await db.query(
      `INSERT INTO xero_connections (
        tenant_id, access_token, refresh_token, tenant_id_xero, expires_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (tenant_id) DO UPDATE
      SET access_token = $2, refresh_token = $3, tenant_id_xero = $4, expires_at = $5, updated_at = NOW()`,
      [tenantId, accessToken, refreshToken, tenantIdXero, expiresAt]
    );

    logger.info('Xero OAuth completed', { tenantId, tenantIdXero });
    return { accessToken, refreshToken };
  }
}

export const xeroOAuth = new XeroOAuth();
