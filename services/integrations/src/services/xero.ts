import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('integrations-service');

type XeroConnectionRow = {
  access_token: string;
  refresh_token: string;
  tenant_id_xero: string;
  expires_at: Date | string | null;
};

type XeroContact = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
};

type XeroTransaction = {
  id: string;
  date: string;
  total: number;
  reference: string;
};

function ensureDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}

function formatIsoDate(date: Date): string {
  const [iso] = date.toISOString().split('T');
  return iso ?? '1970-01-01';
}

async function getConnectionOrThrow(tenantId: TenantId): Promise<XeroConnectionRow> {
  const result = await db.query<XeroConnectionRow>(
    'SELECT access_token, refresh_token, tenant_id_xero, expires_at FROM xero_connections WHERE tenant_id = $1',
    [tenantId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Xero not connected');
  }

  return row;
}

async function ensureValidConnection(tenantId: TenantId): Promise<XeroConnectionRow> {
  let connection = await getConnectionOrThrow(tenantId);
  const expiresAt = ensureDate(connection.expires_at);

  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    await refreshXeroToken(tenantId);
    connection = await getConnectionOrThrow(tenantId);
  }

  return connection;
}

function buildMockContacts(): XeroContact[] {
  return [
    { id: 'xero-contact-1', name: 'Acme Corp', email: 'billing@acme.test', phone: '+1-555-0100' },
    { id: 'xero-contact-2', name: 'Globex LLC', email: 'accounts@globex.test' },
  ];
}

function buildMockTransactions(startDate: Date, endDate: Date): XeroTransaction[] {
  const start = startDate.getTime();
  const end = Math.max(endDate.getTime(), start + 24 * 60 * 60 * 1000);

  return [0, 1, 2].map((index) => {
    const timestamp = new Date(start + ((end - start) / 3) * index);
    const isoDate = formatIsoDate(timestamp);

    return {
      id: `XERO-${index}-${timestamp.getTime()}`,
      date: isoDate,
      total: 250 + index * 125,
      reference: `Xero Transaction ${index + 1}`,
    };
  });
}

function generateMockTokens() {
  return {
    accessToken: `xero_${randomUUID()}`,
    refreshToken: `xero_refresh_${randomUUID()}`,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  };
}

export async function connectXero(
  tenantId: TenantId,
  accessToken: string,
  refreshToken: string,
  tenantIdXero: string
): Promise<void> {
  await db.query(
    `INSERT INTO xero_connections (tenant_id, access_token, refresh_token, tenant_id_xero, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '30 minutes', NOW(), NOW())
     ON CONFLICT (tenant_id) DO UPDATE
     SET access_token = $2, refresh_token = $3, tenant_id_xero = $4, expires_at = NOW() + INTERVAL '30 minutes', updated_at = NOW()`,
    [tenantId, accessToken, refreshToken, tenantIdXero]
  );

  logger.info('Xero connected', { tenantId });
}

export async function syncXeroContacts(tenantId: TenantId): Promise<void> {
  logger.info('Syncing Xero contacts', { tenantId });

  await ensureValidConnection(tenantId);
  const contacts = buildMockContacts();

  for (const contact of contacts) {
    await db.query(
      `INSERT INTO contacts (
        id, tenant_id, name, email, phone, source, source_id, metadata, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, 'xero', $5, $6::jsonb, NOW(), NOW()
      )
      ON CONFLICT (tenant_id, source, source_id) DO UPDATE
      SET name = $2, email = $3, phone = $4, metadata = $6::jsonb, updated_at = NOW()`,
      [
        tenantId,
        contact.name,
        contact.email ?? null,
        contact.phone ?? null,
        contact.id,
        JSON.stringify(contact),
      ]
    );
  }

  logger.info('Xero contacts synced', { tenantId, contactCount: contacts.length });
}

export async function syncXeroTransactions(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<number> {
  logger.info('Syncing Xero transactions', { tenantId, startDate, endDate });

  await ensureValidConnection(tenantId);
  const transactions = buildMockTransactions(startDate, endDate);

  for (const transaction of transactions) {
    await db.query(
      `INSERT INTO bank_transactions (
        id, tenant_id, amount, description, transaction_date, source, source_id, created_at
      ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'xero', $5, NOW())
      ON CONFLICT (tenant_id, source, source_id) DO NOTHING`,
      [
        tenantId,
        transaction.total,
        transaction.reference,
        transaction.date,
        transaction.id,
      ]
    );
  }

  logger.info('Xero transactions synced', { tenantId, synced: transactions.length });
  return transactions.length;
}

export async function refreshXeroToken(tenantId: TenantId): Promise<void> {
  logger.info('Refreshing Xero token', { tenantId });

  const existing = await db.query<{ refresh_token: string }>(
    'SELECT refresh_token FROM xero_connections WHERE tenant_id = $1',
    [tenantId]
  );

  const row = existing.rows[0];
  if (!row) {
    throw new Error('Xero not connected');
  }

  const { accessToken, refreshToken, expiresAt } = generateMockTokens();

  await db.query(
    `UPDATE xero_connections
     SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW()
     WHERE tenant_id = $4`,
    [accessToken, refreshToken, expiresAt, tenantId]
  );

  logger.info('Xero token refreshed', { tenantId });
}
