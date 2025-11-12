import Stripe from 'stripe';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

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
  });

  // Update subscription in database
  await db.query(
    `UPDATE subscriptions
     SET status = 'active',
         current_period_start = $1,
         current_period_end = $2,
         updated_at = NOW()
     WHERE tenant_id = $3`,
    [
      new Date(subscription.current_period_start * 1000),
      new Date(subscription.current_period_end * 1000),
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

  switch (event.type) {
    case 'invoice.payment_succeeded':
      // Handle successful payment
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.subscription) {
        // Update subscription status
        await db.query(
          `UPDATE subscriptions
           SET status = 'active',
               updated_at = NOW()
           WHERE metadata->>'stripeSubscriptionId' = $1`,
          [invoice.subscription as string]
        );
      }
      break;

    case 'invoice.payment_failed':
      // Handle failed payment
      const failedInvoice = event.data.object as Stripe.Invoice;
      logger.warn('Payment failed', { invoiceId: failedInvoice.id });
      // Could send notification, update subscription status, etc.
      break;

    case 'customer.subscription.deleted':
      // Handle subscription cancellation
      const deletedSubscription = event.data.object as Stripe.Subscription;
      await db.query(
        `UPDATE subscriptions
         SET status = 'cancelled',
             updated_at = NOW()
         WHERE metadata->>'stripeSubscriptionId' = $1`,
        [deletedSubscription.id]
      );
      break;

    default:
      logger.debug('Unhandled Stripe event', { type: event.type });
  }
}
