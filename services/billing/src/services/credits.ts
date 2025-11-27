import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('billing-service');

export interface CreditBalance {
  tenantId: TenantId;
  balance: number;
  currency: string;
  updatedAt: Date;
}

export async function getCreditBalance(tenantId: TenantId): Promise<CreditBalance> {
  const result = await db.query<{
    balance: number;
    currency: string;
    updated_at: Date;
  }>(
    `SELECT balance, currency, updated_at
     FROM credits
     WHERE tenant_id = $1`,
    [tenantId]
  );

  const row = result.rows[0];
  if (!row) {
    return { tenantId, balance: 0, currency: 'GBP', updatedAt: new Date() };
  }

  return {
    tenantId,
    balance: Number(row.balance),
    currency: row.currency,
    updatedAt: row.updated_at,
  };
}

export async function applyCredit(tenantId: TenantId, amount: number, reason: string): Promise<CreditBalance> {
  await db.query(
    `INSERT INTO credits (tenant_id, balance, currency, updated_at)
     VALUES ($1, $2, 'GBP', NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       balance = credits.balance + $2,
       updated_at = NOW()`,
    [tenantId, amount]
  );

  await db.query(
    `INSERT INTO credit_ledger (id, tenant_id, amount, reason, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
    [tenantId, amount, reason]
  );

  logger.info('Credit applied', { tenantId, amount, reason });
  return getCreditBalance(tenantId);
}

export async function consumeCredit(tenantId: TenantId, amount: number, memo: string): Promise<CreditBalance> {
  await db.query(
    `UPDATE credits
     SET balance = GREATEST(0, balance - $2), updated_at = NOW()
     WHERE tenant_id = $1`,
    [tenantId, amount]
  );

  await db.query(
    `INSERT INTO credit_ledger (id, tenant_id, amount, reason, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
    [tenantId, -Math.abs(amount), memo]
  );

  logger.info('Credit consumed', { tenantId, amount, memo });
  return getCreditBalance(tenantId);
}
