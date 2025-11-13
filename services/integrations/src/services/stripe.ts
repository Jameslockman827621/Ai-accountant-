import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import crypto from 'crypto';

const logger = createLogger('integrations-service');

export async function connectStripe(
  tenantId: TenantId,
  apiKey: string,
  webhookSecret?: string
): Promise<void> {
  await db.query(
    `INSERT INTO stripe_connections (tenant_id, api_key, webhook_secret, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     ON CONFLICT (tenant_id) DO UPDATE
     SET api_key = $2, webhook_secret = $3, updated_at = NOW()`,
    [tenantId, apiKey, webhookSecret || null]
  );

  logger.info('Stripe connected', { tenantId });
}

export async function syncStripeTransactions(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<number> {
  logger.info('Syncing Stripe transactions', { tenantId, startDate, endDate });
  
  // Get Stripe connection
  const connection = await db.query<{
    api_key: string;
    customer_id: string | null;
  }>(
    'SELECT api_key, customer_id FROM stripe_connections WHERE tenant_id = $1',
    [tenantId]
  );

  if (connection.rows.length === 0) {
    throw new Error('Stripe not connected');
  }

  const apiKey = connection.rows[0].api_key;
  const customerId = connection.rows[0].customer_id;

  // In production, use Stripe SDK
  // const stripe = new Stripe(apiKey);
  // const charges = await stripe.charges.list({
  //   customer: customerId,
  //   created: { gte: Math.floor(startDate.getTime() / 1000), lte: Math.floor(endDate.getTime() / 1000) },
  // });

  // For now, simulate API call
  let synced = 0;

  // In production, would:
  // 1. Fetch charges/payments from Stripe
  // 2. Create bank_transactions for each
  // 3. Create ledger_entries if needed
  // 4. Return count

  logger.info('Stripe transactions synced', { tenantId, synced });
  return synced;
}

export async function verifyStripeWebhookSignature(
  payload: string,
  signature: string,
  webhookSecret: string
): Promise<boolean> {
  try {
    const elements = signature.split(',');
    const sigHash = elements.find((el) => el.startsWith('v1='))?.substring(3);
    
    if (!sigHash) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(sigHash),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    logger.error('Webhook signature verification failed', error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

export async function handleStripeWebhook(
  tenantId: TenantId,
  event: string,
  data: Record<string, unknown>,
  signature?: string
): Promise<void> {
  logger.info('Handling Stripe webhook', { tenantId, event });
  
  // Verify webhook signature if provided
  if (signature) {
    const connection = await db.query<{
      webhook_secret: string | null;
    }>(
      'SELECT webhook_secret FROM stripe_connections WHERE tenant_id = $1',
      [tenantId]
    );

    if (connection.rows.length > 0 && connection.rows[0].webhook_secret) {
      const payload = JSON.stringify(data);
      const isValid = await verifyStripeWebhookSignature(
        payload,
        signature,
        connection.rows[0].webhook_secret
      );

      if (!isValid) {
        throw new Error('Invalid webhook signature');
      }
    }
  }
  
  // Handle different Stripe events
  switch (event) {
    case 'payment_intent.succeeded':
      // Create ledger entry for successful payment
      const paymentIntent = data.object as { amount: number; currency: string; description?: string };
      await db.query(
        `INSERT INTO ledger_entries (
          id, tenant_id, entry_type, account_code, account_name, amount, currency, description, transaction_date, created_at
        ) VALUES (
          gen_random_uuid(), $1, 'credit', '4000', 'Sales', $2, $3, $4, CURRENT_DATE, NOW()
        )`,
        [tenantId, paymentIntent.amount / 100, paymentIntent.currency.toUpperCase(), paymentIntent.description || 'Stripe payment']
      );
      break;
    case 'charge.refunded':
      // Create ledger entry for refund
      const refund = data.object as { amount: number; currency: string };
      await db.query(
        `INSERT INTO ledger_entries (
          id, tenant_id, entry_type, account_code, account_name, amount, currency, description, transaction_date, created_at
        ) VALUES (
          gen_random_uuid(), $1, 'debit', '4000', 'Sales', $2, $3, 'Stripe refund', CURRENT_DATE, NOW()
        )`,
        [tenantId, refund.amount / 100, refund.currency.toUpperCase()]
      );
      break;
    default:
      logger.warn('Unhandled Stripe event', { event });
  }
}
