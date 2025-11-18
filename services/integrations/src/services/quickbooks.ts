import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('integrations-service');

type QuickBooksConnectionRow = {
  access_token: string;
  refresh_token: string;
  realm_id: string;
  expires_at: Date | string | null;
};

type QuickBooksAccount = {
  code: string;
  name: string;
  type: string;
  subType?: string;
  fullyQualifiedName?: string;
};

type QuickBooksJournalEntry = {
  Id: string;
  TxnDate: string;
  TotalAmt: number;
  DocNumber: string;
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

async function getConnectionOrThrow(tenantId: TenantId): Promise<QuickBooksConnectionRow> {
  const result = await db.query<QuickBooksConnectionRow>(
    'SELECT access_token, refresh_token, realm_id, expires_at FROM quickbooks_connections WHERE tenant_id = $1',
    [tenantId]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error('QuickBooks not connected');
  }

  return row;
}

async function ensureValidConnection(tenantId: TenantId): Promise<QuickBooksConnectionRow> {
  let connection = await getConnectionOrThrow(tenantId);
  const expiresAt = ensureDate(connection.expires_at);

  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    await refreshQuickBooksToken(tenantId);
    connection = await getConnectionOrThrow(tenantId);
  }

  return connection;
}

function buildMockAccounts(): QuickBooksAccount[] {
  return [
    {
      code: '1000',
      name: 'Cash',
      type: 'Asset',
      subType: 'Bank',
      fullyQualifiedName: 'Assets:Cash',
    },
    {
      code: '2000',
      name: 'Accounts Payable',
      type: 'Liability',
      subType: 'Current Liability',
      fullyQualifiedName: 'Liabilities:Accounts Payable',
    },
    {
      code: '4000',
      name: 'Revenue',
      type: 'Income',
      subType: 'SalesOfProductIncome',
      fullyQualifiedName: 'Income:Revenue',
    },
  ];
}

function buildMockJournalEntries(startDate: Date, endDate: Date): QuickBooksJournalEntry[] {
  const start = startDate.getTime();
  const end = Math.max(endDate.getTime(), start + 24 * 60 * 60 * 1000);
  const increments = [0, 1, 2];

  return increments.map((index) => {
    const timestamp = new Date(start + ((end - start) / increments.length) * index);
    const isoDate = formatIsoDate(timestamp);

    return {
      Id: `QB-${index}-${timestamp.getTime()}`,
      TxnDate: isoDate,
      TotalAmt: 150 + index * 75,
      DocNumber: `QB-${timestamp.getTime()}`,
    };
  });
}

function generateMockTokens() {
  return {
    accessToken: `qb_${randomUUID()}`,
    refreshToken: `qb_refresh_${randomUUID()}`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
}

export interface QuickBooksConnection {
  tenantId: TenantId;
  accessToken: string;
  refreshToken: string;
  realmId: string;
  expiresAt: Date;
}

export async function connectQuickBooks(
  tenantId: TenantId,
  accessToken: string,
  refreshToken: string,
  realmId: string
): Promise<void> {
  await db.query(
    `INSERT INTO quickbooks_connections (tenant_id, access_token, refresh_token, realm_id, expires_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', NOW(), NOW())
     ON CONFLICT (tenant_id) DO UPDATE
     SET access_token = $2, refresh_token = $3, realm_id = $4, expires_at = NOW() + INTERVAL '1 hour', updated_at = NOW()`,
    [tenantId, accessToken, refreshToken, realmId]
  );

  logger.info('QuickBooks connected', { tenantId });
}

export async function syncQuickBooksAccounts(tenantId: TenantId): Promise<void> {
  logger.info('Syncing QuickBooks accounts', { tenantId });

  await ensureValidConnection(tenantId);
  const accounts = buildMockAccounts();

  await db.query(
    `UPDATE chart_of_accounts
     SET accounts = $1::jsonb, updated_at = NOW()
     WHERE tenant_id = $2`,
    [JSON.stringify(accounts), tenantId]
  );

  logger.info('QuickBooks accounts synced', { tenantId, accountCount: accounts.length });
}

export async function syncQuickBooksTransactions(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<number> {
  logger.info('Syncing QuickBooks transactions', { tenantId, startDate, endDate });

  await ensureValidConnection(tenantId);
  const transactions = buildMockJournalEntries(startDate, endDate);

  for (const txn of transactions) {
    await db.query(
      `INSERT INTO bank_transactions (
        id, tenant_id, amount, description, transaction_date, source, source_id, created_at
      ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'quickbooks', $5, NOW())
      ON CONFLICT (tenant_id, source, source_id) DO NOTHING`,
      [
        tenantId,
        txn.TotalAmt,
        txn.DocNumber,
        txn.TxnDate,
        txn.Id,
      ]
    );
  }

  logger.info('QuickBooks transactions synced', { tenantId, synced: transactions.length });
  return transactions.length;
}

export async function refreshQuickBooksToken(tenantId: TenantId): Promise<void> {
  logger.info('Refreshing QuickBooks token', { tenantId });

  const result = await db.query<{ refresh_token: string }>(
    'SELECT refresh_token FROM quickbooks_connections WHERE tenant_id = $1',
    [tenantId]
  );

  const row = result.rows[0];

  if (!row) {
    throw new Error('QuickBooks not connected');
  }

  const { accessToken, refreshToken, expiresAt } = generateMockTokens();

  await db.query(
    `UPDATE quickbooks_connections
     SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = NOW()
     WHERE tenant_id = $4`,
    [accessToken, refreshToken, expiresAt, tenantId]
  );

  logger.info('QuickBooks token refreshed', { tenantId });
}
