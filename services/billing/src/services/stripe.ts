import Stripe from 'stripe';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

export type BillingTier = 'freelancer' | 'sme' | 'accountant' | 'enterprise';

const logger = createLogger('billing-service');

let stripe: Stripe | null = null;

function getStripeClient(): Stripe {
  if (!stripe) {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripe = new Stripe(apiKey, {
      apiVersion: '2023-10-16',
    });
  }
  return stripe;
}

export async function createCustomer(tenantId: TenantId, email: string, name: string): Promise<string> {
  const client = getStripeClient();
  
  const customer = await client.customers.create({
    email,
    name,
    metadata: {
      tenantId,
    },
  });

  // Store Stripe customer ID
  await db.query(
    `UPDATE tenants
     SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{stripeCustomerId}', $1::jsonb),
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(customer.id), tenantId]
  );

  logger.info('Stripe customer created', { tenantId, customerId: customer.id });
  return customer.id;
}

export async function ensureStripeCustomer(tenantId: TenantId): Promise<string> {
  const tenant = await db.query<{
    name: string;
    metadata: unknown;
  }>(
    `SELECT name, metadata
     FROM tenants
     WHERE id = $1`,
    [tenantId]
  );

  const tenantRow = tenant.rows[0];
  if (!tenantRow) {
    throw new Error('Tenant not found');
  }

  const metadata = (tenantRow.metadata as Record<string, unknown> | null) ?? {};
  const existingCustomerId = typeof metadata.stripeCustomerId === 'string' ? metadata.stripeCustomerId : undefined;
  if (existingCustomerId) {
    return existingCustomerId;
  }

  const user = await db.query<{ email: string }>(
    'SELECT email FROM users WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1',
    [tenantId]
  );

  const userRow = user.rows[0];
  if (!userRow) {
    throw new Error('No user found for tenant');
  }

  return createCustomer(tenantId, userRow.email, tenantRow.name);
}

export async function createSubscription(
  tenantId: TenantId,
  customerId: string,
  priceId: string
): Promise<Stripe.Subscription> {
  const client = getStripeClient();

  const subscription = await client.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent'],
    metadata: {
      tenantId,
    },
  });

  // Update subscription in database
  await db.query(
    `UPDATE subscriptions
     SET status = 'active',
         current_period_start = $1,
         current_period_end = $2,
         metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{stripeSubscriptionId}', $3::jsonb, true),
         updated_at = NOW()
     WHERE tenant_id = $4`,
    [
      new Date(subscription.current_period_start * 1000),
      new Date(subscription.current_period_end * 1000),
      JSON.stringify(subscription.id),
      tenantId,
    ]
  );

  logger.info('Stripe subscription created', { tenantId, subscriptionId: subscription.id });
  return subscription;
}

export async function cancelSubscription(
  tenantId: TenantId,
  subscriptionId: string,
  cancelAtPeriodEnd: boolean = true
): Promise<void> {
  const client = getStripeClient();

  if (cancelAtPeriodEnd) {
    await client.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  } else {
    await client.subscriptions.cancel(subscriptionId);
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

  logger.info('Stripe subscription cancelled', { tenantId, subscriptionId, cancelAtPeriodEnd });
}

export async function updatePaymentMethod(
  customerId: string,
  paymentMethodId: string
): Promise<void> {
  const client = getStripeClient();

  await client.paymentMethods.attach(paymentMethodId, {
    customer: customerId,
  });

  await client.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  });

  logger.info('Payment method updated', { customerId, paymentMethodId });
}

export async function handleStripeWebhook(
  event: Stripe.Event
): Promise<void> {
  logger.info('Processing Stripe webhook', { type: event.type });
  const client = getStripeClient();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const subscription = await client.subscriptions.retrieve(
          session.subscription as string
        );
        await syncSubscriptionFromStripe(subscription);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      await syncSubscriptionFromStripe(subscription);
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await markSubscriptionCancelled(subscription);
      break;
    }
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.subscription) {
        const subscription = await client.subscriptions.retrieve(
          invoice.subscription as string
        );
        await syncSubscriptionFromStripe(subscription);
      }
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const tenantId = invoice.metadata?.tenantId as string | undefined;
      
      if (tenantId && invoice.subscription) {
        // Handle payment failure with dunning management
        const { handlePaymentFailure } = await import('./paymentFailureHandler');
          let failureMessage = 'Payment failed';
          if (invoice.payment_intent) {
            try {
              const paymentIntent =
                typeof invoice.payment_intent === 'string'
                  ? await client.paymentIntents.retrieve(invoice.payment_intent)
                  : invoice.payment_intent;
              failureMessage = paymentIntent.last_payment_error?.message ?? failureMessage;
            } catch (intentError) {
              logger.warn('Unable to retrieve payment intent for failure message', {
                invoiceId: invoice.id,
                error: intentError instanceof Error ? intentError.message : intentError,
              });
            }
          }
        await handlePaymentFailure(
          tenantId,
          invoice.id,
            failureMessage
        );
        
        // Send notification to user
        const { notificationManager } = await import('@ai-accountant/notification-service/services/notificationManager');
        await notificationManager.createNotification(
          tenantId,
          null,
          'error',
          'Payment Failed',
          `Your payment for invoice ${invoice.number || invoice.id} has failed. Please update your payment method to avoid service interruption.`,
          {
            label: 'Update Payment Method',
            url: '/settings/billing',
          },
          {
            invoiceId: invoice.id,
            amount: invoice.amount_due / 100,
            currency: invoice.currency,
          }
        );
      }
      
      logger.warn('Stripe invoice payment failed', {
        invoiceId: invoice.id,
        subscriptionId: invoice.subscription,
        tenantId,
      });
      break;
    }
    default:
      logger.debug('Unhandled Stripe event', { type: event.type });
  }
}

function mapStripeStatus(status: Stripe.Subscription.Status): 'active' | 'cancelled' | 'expired' {
  switch (status) {
    case 'canceled':
      return 'cancelled';
    case 'unpaid':
    case 'incomplete_expired':
      return 'expired';
    default:
      return 'active';
  }
}

async function syncSubscriptionFromStripe(subscription: Stripe.Subscription): Promise<void> {
  const tenantId = subscription.metadata?.tenantId as string | undefined;
  if (!tenantId) {
    logger.warn('Stripe subscription missing tenant metadata', { subscriptionId: subscription.id });
    return;
  }

  const tier =
    (subscription.metadata?.tier as BillingTier | undefined) ??
    (await getTenantTier(tenantId));
  const status = mapStripeStatus(subscription.status);
  const currentPeriodStart = new Date(subscription.current_period_start * 1000);
  const currentPeriodEnd = new Date(subscription.current_period_end * 1000);
  const cancelAtPeriodEnd = subscription.cancel_at_period_end ?? false;

  await db.query(
    `INSERT INTO subscriptions (
       tenant_id,
       tier,
       status,
       current_period_start,
       current_period_end,
       cancel_at_period_end,
       metadata,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, jsonb_build_object('stripeSubscriptionId', $7), NOW(), NOW())
     ON CONFLICT (tenant_id) DO UPDATE SET
       tier = EXCLUDED.tier,
       status = EXCLUDED.status,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       metadata = jsonb_set(COALESCE(subscriptions.metadata, '{}'::jsonb), '{stripeSubscriptionId}', to_jsonb($7::text), true),
       updated_at = NOW()`,
    [
      tenantId,
      tier,
      status,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      subscription.id,
    ]
  );

  if (subscription.metadata?.tier) {
    await db.query(
      `UPDATE tenants
       SET subscription_tier = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [tenantId, subscription.metadata.tier]
    );
  }

  logger.info('Stripe subscription synced', {
    tenantId,
    subscriptionId: subscription.id,
    status,
  });
}

async function markSubscriptionCancelled(subscription: Stripe.Subscription): Promise<void> {
  const tenantId = subscription.metadata?.tenantId as string | undefined;
  if (!tenantId) {
    logger.warn('Cannot cancel subscription without tenant metadata', {
      subscriptionId: subscription.id,
    });
    return;
  }

  await db.query(
    `UPDATE subscriptions
     SET status = 'cancelled',
         cancel_at_period_end = true,
         metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{stripeSubscriptionId}', to_jsonb($1::text), true),
         updated_at = NOW()
     WHERE tenant_id = $2`,
    [subscription.id, tenantId]
  );

  logger.info('Subscription cancelled via webhook', { tenantId, subscriptionId: subscription.id });
}

async function getTenantTier(tenantId: TenantId): Promise<BillingTier> {
  const result = await db.query<{ subscription_tier: BillingTier }>(
    'SELECT subscription_tier FROM tenants WHERE id = $1',
    [tenantId]
  );

  const row = result.rows[0];
  if (!row) {
    return 'freelancer';
  }

  return row.subscription_tier;
}

export async function createCheckoutSession(
  tenantId: TenantId,
  tier: BillingTier,
  successUrl: string,
  cancelUrl: string
): Promise<Stripe.Checkout.Session> {
  const priceId = process.env[`STRIPE_PRICE_${tier.toUpperCase()}`];
  if (!priceId) {
    throw new Error(`Stripe price for tier ${tier} is not configured`);
  }

  const customerId = await ensureStripeCustomer(tenantId);
  const client = getStripeClient();

  const session = await client.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: {
        tenantId,
        tier,
      },
    },
    metadata: {
      tenantId,
      tier,
    },
  });

  return session;
}

export async function createBillingPortalSession(
  tenantId: TenantId,
  returnUrl: string
): Promise<Stripe.BillingPortal.Session> {
  const customerId = await ensureStripeCustomer(tenantId);
  const client = getStripeClient();

  return client.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

export async function createOneTimePaymentIntent(
  tenantId: TenantId,
  amount: number,
  currency: string,
  metadata?: Record<string, unknown>
): Promise<Stripe.PaymentIntent> {
  const client = getStripeClient();
  const customerId = await ensureStripeCustomer(tenantId);

  const paymentIntent = await client.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: currency.toLowerCase(),
    customer: customerId,
    metadata: {
      tenantId,
      ...metadata,
    },
    automatic_payment_methods: { enabled: true },
  });

  return paymentIntent;
}

export async function listPaymentMethods(tenantId: TenantId): Promise<Stripe.ApiList<Stripe.PaymentMethod>> {
  const client = getStripeClient();
  const customerId = await ensureStripeCustomer(tenantId);
  return client.paymentMethods.list({
    customer: customerId,
    type: 'card',
  });
}

export function constructStripeEvent(payload: Buffer, signature?: string | string[]): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  }

  if (!signature) {
    throw new Error('Missing Stripe signature header');
  }

  const client = getStripeClient();
  return client.webhooks.constructEvent(payload, signature as string, secret);
}
