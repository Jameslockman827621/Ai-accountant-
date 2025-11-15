import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import {
  SecretPayload,
  encryptSecret,
  decryptSecret,
} from '@ai-accountant/secure-store';

type Provider = 'plaid' | 'truelayer';

interface ConnectionRecord extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  provider: Provider;
  access_token_encrypted: SecretPayload | string | null;
  refresh_token_encrypted: SecretPayload | string | null;
  token_expires_at: Date | null;
  last_refreshed_at: Date | null;
  provider_account_id: string | null;
  item_id: string | null;
  metadata: Record<string, unknown> | null;
  is_active: boolean;
}

export interface PersistConnectionInput {
  tenantId: TenantId;
  provider: Provider;
  accessToken: string;
  refreshToken?: string | null;
  itemId?: string | null;
  providerAccountId?: string | null;
  metadata?: Record<string, unknown>;
  tokenExpiresAt?: Date | null;
}

export interface ConnectionSecrets {
  connectionId: string;
  tenantId: TenantId;
  provider: Provider;
  accessToken: string;
  refreshToken?: string | null;
  metadata?: Record<string, unknown> | null;
  itemId?: string | null;
  providerAccountId?: string | null;
  tokenExpiresAt?: Date | null;
}

function serializeSecret(value: string | null | undefined): SecretPayload | null {
  if (!value) {
    return null;
  }
  return encryptSecret(value);
}

function deserializeSecret(payload: SecretPayload | string | null): string | null {
  if (!payload) {
    return null;
  }
  if (typeof payload === 'string') {
    return decryptSecret(JSON.parse(payload) as SecretPayload);
  }
  return decryptSecret(payload);
}

export async function persistConnectionTokens(
  input: PersistConnectionInput
): Promise<string> {
  const accessPayload = serializeSecret(input.accessToken);
  const refreshPayload = serializeSecret(input.refreshToken);

  const result = await db.query<{ id: string }>(
    `INSERT INTO bank_connections (
        tenant_id,
        provider,
        access_token_encrypted,
        refresh_token_encrypted,
        token_expires_at,
        last_refreshed_at,
        item_id,
        provider_account_id,
        metadata,
        is_active
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, NOW(), $6, $7, $8::jsonb, true)
      ON CONFLICT (tenant_id, provider, COALESCE(provider_account_id, item_id))
      DO UPDATE SET
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
        token_expires_at = EXCLUDED.token_expires_at,
        last_refreshed_at = NOW(),
        item_id = EXCLUDED.item_id,
        provider_account_id = EXCLUDED.provider_account_id,
        metadata = EXCLUDED.metadata,
        is_active = true,
        updated_at = NOW()
      RETURNING id`,
    [
      input.tenantId,
      input.provider,
      accessPayload ? JSON.stringify(accessPayload) : null,
      refreshPayload ? JSON.stringify(refreshPayload) : null,
      input.tokenExpiresAt || null,
      input.itemId || null,
      input.providerAccountId || null,
      JSON.stringify(input.metadata || {}),
    ]
  );

  return result.rows[0].id;
}

async function fetchConnectionById(
  connectionId: string
): Promise<ConnectionRecord | null> {
  const result = await db.query<ConnectionRecord>(
    `SELECT *
     FROM bank_connections
     WHERE id = $1`,
    [connectionId]
  );
  return result.rows[0] || null;
}

export async function getConnectionSecrets(
  connectionId: string,
  tenantId: TenantId
): Promise<ConnectionSecrets> {
  const record = await fetchConnectionById(connectionId);
  if (!record || record.tenant_id !== tenantId || !record.is_active) {
    throw new Error('Bank connection not found');
  }

  const accessToken = deserializeSecret(record.access_token_encrypted);
  if (!accessToken) {
    throw new Error('Bank connection token not available');
  }

  return {
    connectionId: record.id,
    tenantId: record.tenant_id,
    provider: record.provider,
    accessToken,
    refreshToken: deserializeSecret(record.refresh_token_encrypted),
    metadata: record.metadata,
    itemId: record.item_id,
    providerAccountId: record.provider_account_id,
    tokenExpiresAt: record.token_expires_at ? new Date(record.token_expires_at) : null,
  };
}

export async function getConnectionByProviderAccount(
  provider: Provider,
  providerAccountId: string
): Promise<ConnectionSecrets | null> {
  const result = await db.query<ConnectionRecord>(
    `SELECT *
     FROM bank_connections
     WHERE provider = $1
       AND COALESCE(provider_account_id, item_id) = $2
       AND is_active = true`,
    [provider, providerAccountId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const accessToken = deserializeSecret(row.access_token_encrypted);
  if (!accessToken) {
    return null;
  }

  return {
    connectionId: row.id,
    tenantId: row.tenant_id,
    provider: row.provider,
    accessToken,
    refreshToken: deserializeSecret(row.refresh_token_encrypted),
    metadata: row.metadata,
    itemId: row.item_id,
    providerAccountId: row.provider_account_id,
    tokenExpiresAt: row.token_expires_at ? new Date(row.token_expires_at) : null,
  };
}

export async function markConnectionRefreshed(
  connectionId: string,
  tokens: { accessToken: string; refreshToken?: string | null; tokenExpiresAt?: Date | null }
): Promise<void> {
  await db.query(
    `UPDATE bank_connections
     SET access_token_encrypted = $2::jsonb,
         refresh_token_encrypted = $3::jsonb,
         token_expires_at = $4,
         last_refreshed_at = NOW()
     WHERE id = $1`,
    [
      connectionId,
      JSON.stringify(serializeSecret(tokens.accessToken)),
      tokens.refreshToken
        ? JSON.stringify(serializeSecret(tokens.refreshToken))
        : null,
      tokens.tokenExpiresAt || null,
    ]
  );
}
