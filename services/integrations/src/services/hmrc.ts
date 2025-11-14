import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import axios from 'axios';

const logger = createLogger('integrations-service');

const HMRC_BASE_URL = process.env.HMRC_BASE_URL || 'https://api.service.hmrc.gov.uk';
const HMRC_CLIENT_ID = process.env.HMRC_CLIENT_ID;
const HMRC_CLIENT_SECRET = process.env.HMRC_CLIENT_SECRET;

export interface HMRCConnection {
  tenantId: TenantId;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

let tokenCache: Map<string, { token: string; expiresAt: Date }> = new Map();

export async function getHMRCAccessToken(tenantId: TenantId): Promise<string> {
  // Check cache
  const cached = tokenCache.get(tenantId);
  if (cached && cached.expiresAt > new Date()) {
    return cached.token;
  }

  // Get stored refresh token
  const connection = await db.query<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
  }>(
    'SELECT access_token, refresh_token, expires_at FROM hmrc_connections WHERE tenant_id = $1',
    [tenantId]
  );

  if (connection.rows.length === 0) {
    throw new Error('HMRC not connected');
  }

  const { refresh_token, expires_at } = connection.rows[0];

  // Refresh if expired
  if (new Date(expires_at) < new Date()) {
    await refreshHMRCToken(tenantId);
    const refreshed = await db.query<{ access_token: string; expires_at: Date }>(
      'SELECT access_token, expires_at FROM hmrc_connections WHERE tenant_id = $1',
      [tenantId]
    );
    const newToken = refreshed.rows[0].access_token;
    const newExpiresAt = refreshed.rows[0].expires_at;
    tokenCache.set(tenantId, { token: newToken, expiresAt: newExpiresAt });
    return newToken;
  }

  const accessToken = connection.rows[0].access_token;
  tokenCache.set(tenantId, { token: accessToken, expiresAt: new Date(expires_at) });
  return accessToken;
}

export async function refreshHMRCToken(tenantId: TenantId): Promise<void> {
  logger.info('Refreshing HMRC token', { tenantId });

  const connection = await db.query<{
    refresh_token: string;
  }>(
    'SELECT refresh_token FROM hmrc_connections WHERE tenant_id = $1',
    [tenantId]
  );

  if (connection.rows.length === 0) {
    throw new Error('HMRC not connected');
  }

  const { refresh_token } = connection.rows[0];

  try {
    const response = await axios.post(
      `${HMRC_BASE_URL}/oauth/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: HMRC_CLIENT_ID!,
        client_secret: HMRC_CLIENT_SECRET!,
        refresh_token: refresh_token,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token: new_refresh_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Update stored tokens
    await db.query(
      `UPDATE hmrc_connections
       SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW()
       WHERE tenant_id = $4`,
      [access_token, new_refresh_token, expiresAt, tenantId]
    );

    tokenCache.set(tenantId, { token: access_token, expiresAt });
    logger.info('HMRC token refreshed', { tenantId });
  } catch (error) {
    logger.error('HMRC token refresh failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function connectHMRC(
  tenantId: TenantId,
  authorizationCode: string,
  redirectUri: string
): Promise<void> {
  logger.info('Connecting HMRC', { tenantId });

  if (!HMRC_CLIENT_ID || !HMRC_CLIENT_SECRET) {
    throw new Error('HMRC credentials not configured');
  }

  try {
    // Exchange authorization code for tokens
    const response = await axios.post(
      `${HMRC_BASE_URL}/oauth/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: HMRC_CLIENT_ID,
        client_secret: HMRC_CLIENT_SECRET,
        code: authorizationCode,
        redirect_uri: redirectUri,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Store connection (would need hmrc_connections table)
    await db.query(
      `INSERT INTO hmrc_connections (
        tenant_id, access_token, refresh_token, expires_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (tenant_id) DO UPDATE
      SET access_token = $2, refresh_token = $3, expires_at = $4, updated_at = NOW()`,
      [tenantId, access_token, refresh_token, expiresAt]
    );

    tokenCache.set(tenantId, { token: access_token, expiresAt });
    logger.info('HMRC connected', { tenantId });
  } catch (error) {
    logger.error('HMRC connection failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function getHMRCVATReturns(tenantId: TenantId, vrn: string): Promise<unknown[]> {
  const accessToken = await getHMRCAccessToken(tenantId);

  try {
    const response = await axios.get(
      `${HMRC_BASE_URL}/organisations/vat/${vrn}/returns`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.hmrc.1.0+json',
        },
      }
    );

    return response.data;
  } catch (error) {
    logger.error('Failed to get HMRC VAT returns', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function submitHMRCVATReturn(
  tenantId: TenantId,
  vrn: string,
  returnData: Record<string, unknown>
): Promise<void> {
  const accessToken = await getHMRCAccessToken(tenantId);

  try {
    await axios.put(
      `${HMRC_BASE_URL}/organisations/vat/${vrn}/returns/${returnData.periodKey}`,
      returnData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.hmrc.1.0+json',
          'Content-Type': 'application/json',
        },
      }
    );

    logger.info('HMRC VAT return submitted', { tenantId, vrn, periodKey: returnData.periodKey });
  } catch (error) {
    logger.error('Failed to submit HMRC VAT return', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}
