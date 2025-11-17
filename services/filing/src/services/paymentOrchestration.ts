import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import { createLogger } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';

const logger = createLogger('payment-orchestrator');

const ensureTable = db.query(`
  CREATE TABLE IF NOT EXISTS filing_payment_requests (
    id UUID PRIMARY KEY,
    filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    authority VARCHAR(100) NOT NULL,
    amount NUMERIC(18,2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
    method VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    response JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

export async function initiateAuthorityPayment(args: {
  filingId: string;
  tenantId: TenantId;
  authority: string;
  amount: number;
  currency?: string;
  method?: 'authority_api' | 'bank_transfer';
}): Promise<string> {
  await ensureTable;

  const id = randomUUID();
  await db.query(
    `INSERT INTO filing_payment_requests (
        id, filing_id, tenant_id, authority, amount, currency, method, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
    [
      id,
      args.filingId,
      args.tenantId,
      args.authority,
      args.amount,
      (args.currency || 'GBP').toUpperCase(),
      args.method || 'authority_api',
    ]
  );

  logger.info('Initiated authority payment request', {
    id,
    authority: args.authority,
    amount: args.amount,
  });

  return id;
}

export async function markPaymentStatus(
  paymentRequestId: string,
  status: 'initiated' | 'completed' | 'failed',
  response?: Record<string, unknown>
): Promise<void> {
  await ensureTable;
  await db.query(
    `UPDATE filing_payment_requests
        SET status = $2,
            response = COALESCE($3::jsonb, response),
            updated_at = NOW()
      WHERE id = $1`,
    [paymentRequestId, status, response ? JSON.stringify(response) : null]
  );
}
