import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import { ValidationError, createLogger } from '@ai-accountant/shared-utils';
import { randomUUID, createHmac } from 'crypto';
import {
  HMRCClient,
  HMRCAuthTokens,
  VATObligation,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from '@ai-accountant/hmrc';
import {
  SecretPayload,
  decryptSecret,
  encryptSecret,
} from '@ai-accountant/secure-store';

const logger = createLogger('integrations-service');

const HMRC_ENV = process.env.HMRC_ENV === 'production' ? 'production' : 'sandbox';
const HMRC_BASE_URL = process.env.HMRC_BASE_URL;
const HMRC_CLIENT_ID = process.env.HMRC_CLIENT_ID || '';
const HMRC_CLIENT_SECRET = process.env.HMRC_CLIENT_SECRET || '';
const HMRC_SCOPE =
  process.env.HMRC_SCOPE || 'read:vat write:vat read:vrn-summary';
const HMRC_AUTH_BASE =
  process.env.HMRC_AUTH_BASE_URL ||
  HMRC_BASE_URL ||
  (HMRC_ENV === 'production'
    ? 'https://api.service.hmrc.gov.uk'
    : 'https://test-api.service.hmrc.gov.uk');
const HMRC_STATE_SECRET =
  process.env.HMRC_STATE_SECRET || HMRC_CLIENT_SECRET || '';
const HMRC_STATE_TTL_MS = parseInt(
  process.env.HMRC_STATE_TTL_MS || '900000',
  10
);

interface HMRCConnectionRow extends Record<string, unknown> {
  tenant_id: string;
  access_token_encrypted: SecretPayload | string | null;
  refresh_token_encrypted: SecretPayload | string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: Date | null;
  refresh_expires_at: Date | null;
  scopes: string[] | null;
  vrn: string | null;
  consent_expires_at: Date | null;
  connection_status: string | null;
}

export interface TenantHMRCAuth {
  tenantId: TenantId;
  accessToken: string;
  refreshToken: string;
  vrn: string;
  scopes: string[];
  expiresAt: Date;
  refreshExpiresAt?: Date | null;
}

const tokenCache = new Map<
  string,
  {
    token: string;
    expiresAt: Date;
    vrn: string;
    scopes: string[];
  }
>();

function requireCredentials(): void {
  if (!HMRC_CLIENT_ID || !HMRC_CLIENT_SECRET) {
    throw new Error('HMRC client credentials are not configured');
  }
  if (!HMRC_STATE_SECRET) {
    throw new Error('HMRC state secret is not configured');
  }
}

function scopeStringToArray(
  scope?: string | null,
  scopes?: string[] | null
): string[] {
  if (Array.isArray(scopes) && scopes.length > 0) {
    return scopes;
  }
  if (!scope) {
    return HMRC_SCOPE.split(/\s+/).filter(Boolean);
  }
  return scope
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function serializeSecret(secret: SecretPayload): string {
  return JSON.stringify(secret);
}

function buildHMRCAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: HMRC_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: HMRC_SCOPE,
    state,
  });
  const base = HMRC_AUTH_BASE?.replace(/\/+$/, '') || '';
  return `${base}/oauth/authorize?${params.toString()}`;
}

function createStateToken(tenantId: TenantId, userId: string): string {
  const issuedAt = Date.now();
  const nonce = randomUUID();
  const base = `${tenantId}:${userId}:${issuedAt}:${nonce}`;
  const signature = createHmac('sha256', HMRC_STATE_SECRET).update(base).digest('hex');
  return `${base}:${signature}`;
}

function verifyStateToken(stateToken: string, tenantId: TenantId, userId: string): void {
  const segments = stateToken.split(':');
  if (segments.length !== 5) {
    throw new ValidationError('Invalid HMRC authorization state token');
  }

  const [tokenTenantId, tokenUserId, issuedAtRaw, nonce, signature] = segments;
  if (tokenTenantId !== tenantId || tokenUserId !== userId) {
    throw new ValidationError('HMRC authorization state mismatch');
  }

  const base = `${tokenTenantId}:${tokenUserId}:${issuedAtRaw}:${nonce}`;
  const expectedSignature = createHmac('sha256', HMRC_STATE_SECRET)
    .update(base)
    .digest('hex');

  if (expectedSignature !== signature) {
    throw new ValidationError('Invalid HMRC authorization state signature');
  }

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > HMRC_STATE_TTL_MS) {
    throw new ValidationError('HMRC authorization attempt expired, please restart');
  }
}

export function getHMRCAuthUrl(
  tenantId: TenantId,
  userId: string,
  redirectUri: string
): { authorizeUrl: string; state: string } {
  requireCredentials();
  if (!redirectUri) {
    throw new ValidationError('redirectUri is required');
  }
  const state = createStateToken(tenantId, userId);
  return {
    authorizeUrl: buildHMRCAuthUrl(redirectUri, state),
    state,
  };
}

async function persistTokens(
  tenantId: TenantId,
  tokens: HMRCAuthTokens,
  vrn: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  const refreshExpiresAt = tokens.refreshTokenExpiresIn
    ? new Date(Date.now() + tokens.refreshTokenExpiresIn * 1000)
    : null;

  const scopes = scopeStringToArray(tokens.scope);

  await db.query(
    `INSERT INTO hmrc_connections (
      tenant_id,
      access_token_encrypted,
      refresh_token_encrypted,
      expires_at,
      refresh_expires_at,
      scopes,
      vrn,
      consent_expires_at,
      connection_status,
      last_connected_at,
      access_token,
      refresh_token
    )
    VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, $8, 'active', NOW(), NULL, NULL)
    ON CONFLICT (tenant_id)
    DO UPDATE SET
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      expires_at = EXCLUDED.expires_at,
      refresh_expires_at = EXCLUDED.refresh_expires_at,
      scopes = EXCLUDED.scopes,
      vrn = EXCLUDED.vrn,
      consent_expires_at = EXCLUDED.consent_expires_at,
      connection_status = EXCLUDED.connection_status,
      last_connected_at = NOW(),
      access_token = NULL,
      refresh_token = NULL,
      updated_at = NOW()`,
    [
      tenantId,
      serializeSecret(encryptSecret(tokens.accessToken)),
      serializeSecret(encryptSecret(tokens.refreshToken)),
      expiresAt,
      refreshExpiresAt,
      scopes,
      vrn,
      refreshExpiresAt,
    ]
  );

  tokenCache.set(String(tenantId), {
    token: tokens.accessToken,
    expiresAt,
    vrn,
    scopes,
  });
}

async function fetchTenantConnection(
  tenantId: TenantId
): Promise<HMRCConnectionRow | null> {
  const result = await db.query<HMRCConnectionRow>(
    `SELECT
        tenant_id,
        access_token_encrypted,
        refresh_token_encrypted,
        access_token,
        refresh_token,
        expires_at,
        refresh_expires_at,
        scopes,
        vrn,
        consent_expires_at,
        connection_status
     FROM hmrc_connections
     WHERE tenant_id = $1`,
    [tenantId]
  );
  return result.rows[0] || null;
}

async function ensureSecretPayload(
  tenantId: TenantId,
  encrypted: SecretPayload | string | null,
  legacyValue: string | null,
  encryptedColumn: 'access_token_encrypted' | 'refresh_token_encrypted',
  legacyColumn: 'access_token' | 'refresh_token'
): Promise<SecretPayload> {
  if (encrypted) {
    if (typeof encrypted === 'string') {
      return JSON.parse(encrypted) as SecretPayload;
    }
    return encrypted;
  }

  if (legacyValue) {
    const payload = encryptSecret(legacyValue);
    await db.query(
      `UPDATE hmrc_connections
       SET ${legacyColumn} = NULL,
           ${encryptedColumn} = $2::jsonb
       WHERE tenant_id = $1`,
      [tenantId, serializeSecret(payload)]
    );
    return payload;
  }

  throw new Error(`HMRC ${legacyColumn} missing for tenant ${tenantId}`);
}

async function getTenantVatNumber(tenantId: TenantId): Promise<string | null> {
  const result = await db.query<{ vat_number: string | null }>(
    'SELECT vat_number FROM tenants WHERE id = $1',
    [tenantId]
  );
  return result.rows[0]?.vat_number || null;
}

export async function connectHMRC(
  tenantId: TenantId,
  authorizationCode: string,
  redirectUri: string,
  userId: string,
  providedVRN?: string,
  stateToken?: string
): Promise<void> {
  requireCredentials();

  if (!stateToken) {
    throw new ValidationError('state token is required for HMRC authorization');
  }

  verifyStateToken(stateToken, tenantId, userId);

  const tenantVRN = providedVRN || (await getTenantVatNumber(tenantId));
  if (!tenantVRN) {
    throw new ValidationError('Tenant VAT number (VRN) is required to connect HMRC');
  }

  const tokenSet = await exchangeAuthorizationCode({
    clientId: HMRC_CLIENT_ID,
    clientSecret: HMRC_CLIENT_SECRET,
    authorizationCode,
    redirectUri,
    env: HMRC_ENV,
    scope: HMRC_SCOPE,
    ...(HMRC_BASE_URL ? { baseUrl: HMRC_BASE_URL } : {}),
  });

  await persistTokens(tenantId, tokenSet, tenantVRN);
  logger.info('HMRC connected', { tenantId });
}

export async function disconnectHMRC(tenantId: TenantId): Promise<void> {
  await db.query('DELETE FROM hmrc_connections WHERE tenant_id = $1', [
    tenantId,
  ]);
  tokenCache.delete(String(tenantId));
  logger.info('HMRC connection removed', { tenantId });
}

export async function getHMRCStatus(
  tenantId: TenantId
): Promise<{
  connected: boolean;
  vrn?: string | null;
  scopes?: string[];
  expiresAt?: Date | null;
  consentExpiresAt?: Date | null;
}> {
  const row = await fetchTenantConnection(tenantId);
  if (!row) {
    return { connected: false };
  }

  return {
    connected: row.connection_status !== 'revoked',
    vrn: row.vrn,
    scopes: row.scopes || scopeStringToArray(),
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    consentExpiresAt: row.consent_expires_at
      ? new Date(row.consent_expires_at)
      : null,
  };
}

async function refreshTenantToken(
  tenantId: TenantId,
  row: HMRCConnectionRow
): Promise<TenantHMRCAuth> {
  if (!row.vrn) {
    throw new Error('Tenant VRN missing; reconnect HMRC');
  }

  requireCredentials();

  const refreshPayload = await ensureSecretPayload(
    tenantId,
    row.refresh_token_encrypted,
    row.refresh_token,
    'refresh_token_encrypted',
    'refresh_token'
  );

  const refreshToken = decryptSecret(refreshPayload);
  const scopes = row.scopes || scopeStringToArray();

  const tokenSet = await refreshAccessToken({
    clientId: HMRC_CLIENT_ID,
    clientSecret: HMRC_CLIENT_SECRET,
    refreshToken,
    env: HMRC_ENV,
    scope: scopes.join(' '),
    ...(HMRC_BASE_URL ? { baseUrl: HMRC_BASE_URL } : {}),
  });

  await persistTokens(tenantId, tokenSet, row.vrn);

  return {
    tenantId,
    accessToken: tokenSet.accessToken,
    refreshToken: tokenSet.refreshToken,
    vrn: row.vrn,
    scopes,
    expiresAt: new Date(Date.now() + tokenSet.expiresIn * 1000),
    refreshExpiresAt: tokenSet.refreshTokenExpiresIn
      ? new Date(Date.now() + tokenSet.refreshTokenExpiresIn * 1000)
      : null,
  };
}

export async function getTenantHMRCAuth(
  tenantId: TenantId
): Promise<TenantHMRCAuth> {
  const cacheEntry = tokenCache.get(String(tenantId));
  if (cacheEntry && cacheEntry.expiresAt.getTime() - Date.now() > 60_000) {
    return {
      tenantId,
      accessToken: cacheEntry.token,
      refreshToken: '',
      vrn: cacheEntry.vrn,
      scopes: cacheEntry.scopes,
      expiresAt: cacheEntry.expiresAt,
    };
  }

  const row = await fetchTenantConnection(tenantId);
  if (!row) {
    throw new Error('HMRC is not connected for this tenant');
  }

  const expiresAt = row.expires_at
    ? new Date(row.expires_at)
    : new Date(Date.now() - 1000);
  const scopes = row.scopes || scopeStringToArray();

  if (expiresAt.getTime() - Date.now() <= 60_000) {
    return refreshTenantToken(tenantId, row);
  }

  const accessPayload = await ensureSecretPayload(
    tenantId,
    row.access_token_encrypted,
    row.access_token,
    'access_token_encrypted',
    'access_token'
  );
  const refreshPayload = await ensureSecretPayload(
    tenantId,
    row.refresh_token_encrypted,
    row.refresh_token,
    'refresh_token_encrypted',
    'refresh_token'
  );

  if (!row.vrn) {
    throw new Error('Tenant VRN is not configured for HMRC');
  }

  const accessToken = decryptSecret(accessPayload);
  const refreshToken = decryptSecret(refreshPayload);

  tokenCache.set(String(tenantId), {
    token: accessToken,
    expiresAt,
    vrn: row.vrn,
    scopes,
  });

  return {
    tenantId,
    accessToken,
    refreshToken,
    vrn: row.vrn,
    scopes,
    expiresAt,
    refreshExpiresAt: row.refresh_expires_at
      ? new Date(row.refresh_expires_at)
      : null,
  };
}

export async function getHMRCAccessToken(
  tenantId: TenantId
): Promise<string> {
  const auth = await getTenantHMRCAuth(tenantId);
  return auth.accessToken;
}

export async function refreshHMRCToken(tenantId: TenantId): Promise<void> {
  const row = await fetchTenantConnection(tenantId);
  if (!row) {
    throw new Error('HMRC is not connected for this tenant');
  }
  await refreshTenantToken(tenantId, row);
  logger.info('HMRC token refreshed', { tenantId });
}

export async function getHMRCObligations(
  tenantId: TenantId,
  options?: { status?: string; from?: string; to?: string }
): Promise<VATObligation[]> {
  const auth = await getTenantHMRCAuth(tenantId);

  const client = new HMRCClient({
    env: HMRC_ENV,
    ...(HMRC_BASE_URL ? { baseUrl: HMRC_BASE_URL } : {}),
    accessToken: auth.accessToken,
  });

  return client.getVatObligations(auth.vrn, options);
}
