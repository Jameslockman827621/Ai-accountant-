import crypto from 'node:crypto';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('billing-service');

export interface PaymentFailure {
  tenantId: TenantId;
  invoiceId: string;
  failureCount: number;
  lastFailureAt: Date;
  nextRetryAt: Date;
  status: 'pending' | 'resolved' | 'escalated';
}

/**
 * Handle payment failures with dunning management
 */
export async function handlePaymentFailure(
  tenantId: TenantId,
  invoiceId: string,
  failureReason: string
): Promise<PaymentFailure> {
  logger.warn('Handling payment failure', { tenantId, invoiceId, failureReason });

  // Get or create failure record
  const existingResult = await db.query<{
    id: string;
    failure_count: number;
    last_failure_at: Date;
  }>(
    `SELECT id, failure_count, last_failure_at
     FROM payment_failures
     WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'pending'`,
    [tenantId, invoiceId]
  );

  let failureCount: number;
  let failureId: string;

  const existingFailure = existingResult.rows[0];

  if (existingFailure) {
    failureId = existingFailure.id;
    failureCount = existingFailure.failure_count + 1;

    // Update existing failure
    const nextRetryAt = calculateNextRetry(failureCount);
    await db.query(
      `UPDATE payment_failures
       SET failure_count = $1,
           last_failure_at = NOW(),
           next_retry_at = $2,
           failure_reason = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [failureCount, nextRetryAt, failureReason, failureId]
    );
  } else {
    // Create new failure record
    failureId = crypto.randomUUID();
    failureCount = 1;
    const nextRetryAt = calculateNextRetry(1);

    await db.query(
      `INSERT INTO payment_failures (
        id, tenant_id, invoice_id, failure_count, last_failure_at,
        next_retry_at, failure_reason, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, NOW(), $5, $6, 'pending', NOW(), NOW())`,
      [failureId, tenantId, invoiceId, failureCount, nextRetryAt, failureReason]
    );
  }

  // Escalate if too many failures
  if (failureCount >= 3) {
    await db.query(
      `UPDATE payment_failures
       SET status = 'escalated', updated_at = NOW()
       WHERE id = $1`,
      [failureId]
    );

    // In production, would trigger notifications, suspend account, etc.
    logger.error('Payment failure escalated', { tenantId, invoiceId, failureCount });
  }

  const nextRetryAt = calculateNextRetry(failureCount);

  return {
    tenantId,
    invoiceId,
    failureCount,
    lastFailureAt: new Date(),
    nextRetryAt,
    status: failureCount >= 3 ? 'escalated' : 'pending',
  };
}

/**
 * Resolve payment failure
 */
export async function resolvePaymentFailure(
  tenantId: TenantId,
  invoiceId: string
): Promise<void> {
  await db.query(
    `UPDATE payment_failures
     SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
     WHERE tenant_id = $1 AND invoice_id = $2 AND status = 'pending'`,
    [tenantId, invoiceId]
  );

  logger.info('Payment failure resolved', { tenantId, invoiceId });
}

function calculateNextRetry(failureCount: number): Date {
  // Retry schedule: 3 days, 7 days, 14 days
  const delays = [3, 7, 14];
  const delayDays = delays[Math.min(failureCount - 1, delays.length - 1)] || 14;
  return new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000);
}
