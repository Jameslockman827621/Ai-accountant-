import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { cancelSubscription } from './stripe';

const logger = createLogger('billing-service');

export interface CancellationRequest {
  tenantId: TenantId;
  userId: UserId;
  reason?: string;
  feedback?: string;
  cancelAtPeriodEnd: boolean;
  requestedAt: Date;
}

/**
 * Self-service subscription cancellation
 */
export async function cancelTenantSubscription(
  tenantId: TenantId,
  userId: UserId,
  reason?: string,
  feedback?: string,
  cancelAtPeriodEnd: boolean = true
): Promise<void> {
  logger.info('Processing subscription cancellation', { tenantId, userId, cancelAtPeriodEnd });

  // Get subscription
  const subResult = await db.query<{
    id: string;
    metadata: string | null;
  }>(
    `SELECT id, metadata
     FROM subscriptions
     WHERE tenant_id = $1 AND status = 'active'`,
    [tenantId]
  );

  if (subResult.rows.length === 0) {
    throw new Error('Active subscription not found');
  }

  const subscription = subResult.rows[0];
  if (!subscription) {
    throw new Error('Active subscription not found');
  }
  const metadata = subscription.metadata ? JSON.parse(subscription.metadata) : {};
  const stripeSubscriptionId = metadata.stripeSubscriptionId as string | undefined;

  // Cancel in Stripe if exists
  if (stripeSubscriptionId) {
    try {
      await cancelSubscription(tenantId, stripeSubscriptionId, cancelAtPeriodEnd);
    } catch (error) {
      logger.error('Stripe cancellation failed', error instanceof Error ? error : new Error(String(error)));
      // Continue with database update even if Stripe fails
    }
  }

  // Update subscription in database
  await db.query(
    `UPDATE subscriptions
     SET cancel_at_period_end = $1,
         status = $2,
         updated_at = NOW()
     WHERE tenant_id = $3`,
    [cancelAtPeriodEnd, cancelAtPeriodEnd ? 'active' : 'cancelled', tenantId]
  );

  // Record cancellation request
  await db.query(
    `INSERT INTO subscription_cancellations (
      id, tenant_id, user_id, reason, feedback, cancel_at_period_end, created_at
    ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
    [tenantId, userId, reason || null, feedback || null, cancelAtPeriodEnd]
  );

  logger.info('Subscription cancellation processed', { tenantId, cancelAtPeriodEnd });
}

/**
 * Get cancellation history
 */
export async function getCancellationHistory(tenantId: TenantId): Promise<CancellationRequest[]> {
  const result = await db.query<{
    tenant_id: string;
    user_id: string;
    reason: string | null;
    feedback: string | null;
    cancel_at_period_end: boolean;
    created_at: Date;
  }>(
    `SELECT tenant_id, user_id, reason, feedback, cancel_at_period_end, created_at
     FROM subscription_cancellations
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId]
  );

  return result.rows.map(row => {
    const request: CancellationRequest = {
      tenantId: row.tenant_id as TenantId,
      userId: row.user_id as UserId,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      requestedAt: row.created_at,
    };

    if (row.reason) {
      request.reason = row.reason;
    }
    if (row.feedback) {
      request.feedback = row.feedback;
    }

    return request;
  });
}
