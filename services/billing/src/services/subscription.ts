import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { createSubscription, cancelSubscription, ensureStripeCustomer } from './stripe';

const logger = createLogger('billing-service');

export async function upgradeSubscription(
  tenantId: TenantId,
  newTier: 'freelancer' | 'sme' | 'accountant' | 'enterprise'
): Promise<void> {
  logger.info('Upgrading subscription', { tenantId, newTier });

  // Get current subscription
  const currentSub = await db.query<{
    tier: string;
    metadata: unknown;
  }>(
    'SELECT tier, metadata FROM subscriptions WHERE tenant_id = $1',
    [tenantId]
  );

  if (currentSub.rows.length === 0) {
    throw new Error('No subscription found');
  }

  // Get tenant info for Stripe customer
  const tenant = await db.query<{
    name: string;
    metadata: unknown;
  }>(
    `SELECT t.name, t.metadata
     FROM tenants t
     WHERE t.id = $1`,
    [tenantId]
  );

  if (tenant.rows.length === 0) {
    throw new Error('Tenant not found');
  }

  const customerId = await ensureStripeCustomer(tenantId);

  // In production, would get price ID from Stripe based on tier
  const priceId = process.env[`STRIPE_PRICE_${newTier.toUpperCase()}`] || '';

  if (!priceId) {
    // For now, just update the tier in database
    await db.query(
      `UPDATE subscriptions
       SET tier = $1, updated_at = NOW()
       WHERE tenant_id = $2`,
      [newTier, tenantId]
    );

    await db.query(
      `UPDATE tenants
       SET subscription_tier = $1, updated_at = NOW()
       WHERE id = $2`,
      [newTier, tenantId]
    );

    logger.info('Subscription tier updated', { tenantId, newTier });
    return;
  }

  // Create or update Stripe subscription
  try {
    const subscription = await createSubscription(tenantId, customerId, priceId);
    
    // Update subscription in database
    await db.query(
      `UPDATE subscriptions
       SET tier = $1,
           status = 'active',
           current_period_start = $2,
           current_period_end = $3,
           updated_at = NOW()
       WHERE tenant_id = $4`,
      [
        newTier,
        new Date(subscription.current_period_start * 1000),
        new Date(subscription.current_period_end * 1000),
        tenantId,
      ]
    );

    await db.query(
      `UPDATE tenants
       SET subscription_tier = $1, updated_at = NOW()
       WHERE id = $2`,
      [newTier, tenantId]
    );

    logger.info('Subscription upgraded', { tenantId, newTier, subscriptionId: subscription.id });
  } catch (error) {
    logger.error('Stripe subscription creation failed', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

export async function cancelTenantSubscription(
  tenantId: TenantId,
  cancelAtPeriodEnd: boolean = true
): Promise<void> {
  logger.info('Cancelling subscription', { tenantId, cancelAtPeriodEnd });

  const subscription = await db.query<{
    metadata: unknown;
  }>(
    'SELECT metadata FROM subscriptions WHERE tenant_id = $1',
    [tenantId]
  );

  const subscriptionRow = subscription.rows[0];
  if (!subscriptionRow) {
    throw new Error('No subscription found');
  }

  const metadata = subscriptionRow.metadata as Record<string, unknown> | null;
  const stripeSubscriptionId = metadata?.stripeSubscriptionId as string | undefined;

  if (stripeSubscriptionId) {
    await cancelSubscription(tenantId, stripeSubscriptionId, cancelAtPeriodEnd);
  } else {
    // Just update database if no Stripe subscription
    await db.query(
      `UPDATE subscriptions
       SET cancel_at_period_end = $1,
           status = CASE WHEN $1 THEN 'active' ELSE 'cancelled' END,
           updated_at = NOW()
       WHERE tenant_id = $2`,
      [cancelAtPeriodEnd, tenantId]
    );
  }

  logger.info('Subscription cancelled', { tenantId, cancelAtPeriodEnd });
}
