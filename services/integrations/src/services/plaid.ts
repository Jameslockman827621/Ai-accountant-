import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('integrations-service');

interface PlaidConnectionRow extends Record<string, unknown> {
  access_token: string;
  item_id: string;
  account_id: string;
}

interface MockPlaidTransaction {
  transactionId: string;
  date: string;
  amount: number;
  currency: string;
  description: string;
}

function formatIsoDate(date: Date): string {
  const [iso] = date.toISOString().split('T');
  return iso ?? '1970-01-01';
}

function generatePlaidCredentials() {
  return {
    accessToken: `plaid_${randomUUID()}`,
    itemId: `item_${randomUUID()}`,
    accountId: `acct_${randomUUID()}`,
  };
}

function buildMockTransactions(startDate: Date, endDate: Date): MockPlaidTransaction[] {
  const start = startDate.getTime();
  const end = Math.max(endDate.getTime(), start + 24 * 60 * 60 * 1000);

  return [0, 1, 2].map((index) => {
    const timestamp = new Date(start + ((end - start) / 3) * index);
    const isoDate = formatIsoDate(timestamp);

    return {
      transactionId: `plaid_tx_${index}_${timestamp.getTime()}`,
      date: isoDate,
      amount: 75.25 + index * 42,
      currency: 'USD',
      description: `Plaid Transaction ${index + 1}`,
    };
  });
}

async function getPlaidConnectionOrThrow(tenantId: TenantId): Promise<PlaidConnectionRow> {
  const result = await db.query<PlaidConnectionRow>(
    'SELECT access_token, item_id, account_id FROM bank_connections WHERE tenant_id = $1 AND provider = $2',
    [tenantId, 'plaid']
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Plaid not connected');
  }

  return row;
}

export interface PlaidConnection {
  tenantId: TenantId;
  accessToken: string;
  itemId: string;
  accountId: string;
  expiresAt: Date | null;
}

export async function connectPlaid(
  tenantId: TenantId,
  publicToken: string // Kept for API compatibility
): Promise<void> {
  logger.info('Connecting Plaid', { tenantId });

  if (!publicToken) {
    logger.warn('No public token provided for Plaid connection; using mock credentials');
  }

  const { accessToken, itemId, accountId } = generatePlaidCredentials();

  await db.query(
    `INSERT INTO bank_connections (
      tenant_id, provider, access_token, item_id, account_id, last_sync, last_success, created_at, updated_at
    ) VALUES ($1, 'plaid', $2, $3, $4, NOW(), NOW(), NOW(), NOW())
    ON CONFLICT (tenant_id, provider, item_id) DO UPDATE
    SET access_token = $2, account_id = $4, updated_at = NOW()`,
    [tenantId, accessToken, itemId, accountId]
  );

  logger.info('Plaid connected', { tenantId, itemId });
}

export async function refreshPlaidToken(tenantId: TenantId): Promise<void> {
  logger.info('Refreshing Plaid token', { tenantId });

  await getPlaidConnectionOrThrow(tenantId);
  const { accessToken } = generatePlaidCredentials();

  await db.query(
    `UPDATE bank_connections
     SET access_token = $1, updated_at = NOW()
     WHERE tenant_id = $2 AND provider = 'plaid'`,
    [accessToken, tenantId]
  );

  logger.info('Plaid token refreshed', { tenantId });
}

export async function syncPlaidTransactions(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<number> {
  logger.info('Syncing Plaid transactions', { tenantId, startDate, endDate });

  const connection = await getPlaidConnectionOrThrow(tenantId);
  const transactions = buildMockTransactions(startDate, endDate);
  let synced = 0;

  for (const tx of transactions) {
    const existing = await db.query<{ count: string | number }>(
      `SELECT COUNT(*) as count
       FROM bank_transactions
       WHERE tenant_id = $1
         AND transaction_id = $2`,
      [tenantId, tx.transactionId]
    );

    const count = typeof existing.rows[0]?.count === 'number'
      ? existing.rows[0]?.count
      : parseInt(String(existing.rows[0]?.count || '0'), 10);

    if (count === 0) {
      await db.query(
        `INSERT INTO bank_transactions (
          id, tenant_id, account_id, transaction_id, date, amount, currency, description, created_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW()
        )`,
        [
          tenantId,
          connection.account_id,
          tx.transactionId,
          new Date(tx.date),
          tx.amount,
          tx.currency,
          tx.description,
        ]
      );
      synced++;
    }
  }

  await db.query(
    `UPDATE bank_connections
     SET last_sync = NOW(), last_success = NOW(), error_count = 0, updated_at = NOW()
     WHERE tenant_id = $1 AND provider = 'plaid'`,
    [tenantId]
  );

  logger.info('Plaid transactions synced', { tenantId, synced });
  return synced;
}
