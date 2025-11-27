import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import Stripe from 'stripe';
import crypto from 'node:crypto';

const logger = createLogger('billing-service');

export type PaymentGateway = 'stripe' | 'paypal' | 'worldpay' | 'sagepay' | 'braintree';

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  gateway: PaymentGateway;
  metadata: Record<string, unknown>;
}

/**
 * Process payment with multiple gateway support
 */
export async function processPayment(
  tenantId: TenantId,
  amount: number,
  currency: string,
  gateway: PaymentGateway,
  paymentMethodId: string,
  metadata?: Record<string, unknown>
): Promise<PaymentIntent> {
  logger.info('Processing payment', { tenantId, amount, gateway });

  switch (gateway) {
    case 'stripe':
      return await processStripePayment(tenantId, amount, currency, paymentMethodId, metadata);
    case 'braintree':
      return await processBraintreePayment(tenantId, amount, currency, paymentMethodId, metadata);
    case 'paypal':
      return await processPayPalPayment(tenantId, amount, currency, paymentMethodId, metadata);
    case 'worldpay':
      return await processWorldpayPayment(tenantId, amount, currency, paymentMethodId, metadata);
    case 'sagepay':
      return await processSagepayPayment(tenantId, amount, currency, paymentMethodId, metadata);
    default:
      throw new Error(`Unsupported payment gateway: ${gateway}`);
  }
}

async function processStripePayment(
  tenantId: TenantId,
  amount: number,
  currency: string,
  paymentMethodId: string,
  metadata?: Record<string, unknown>
): Promise<PaymentIntent> {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2023-10-16',
  });

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100), // Convert to cents
    currency: currency.toLowerCase(),
    payment_method: paymentMethodId,
    confirm: true,
    metadata: {
      tenantId,
      ...metadata,
    },
  });

  return {
    id: paymentIntent.id,
    amount,
    currency,
    status: paymentIntent.status === 'succeeded' ? 'succeeded' : 'pending',
    gateway: 'stripe',
    metadata: paymentIntent.metadata,
  };
}

async function processPayPalPayment(
  tenantId: TenantId,
  amount: number,
  currency: string,
  paymentMethodId: string,
  metadata?: Record<string, unknown>
): Promise<PaymentIntent> {
  // PayPal integration (simplified)
  logger.info('PayPal payment processing', { tenantId, amount });
  const fetchFn = (globalThis as any).fetch as typeof fetch | undefined;
  if (!fetchFn) {
    throw new Error('Fetch API not available');
  }

  const response = await fetchFn('https://api.paypal.com/v2/payments/captures', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.PAYPAL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      amount: {
        value: amount.toFixed(2),
        currency_code: currency,
      },
      payment_method: paymentMethodId,
    }),
  });

  const body = await response.json();

  return {
    id: body.id || crypto.randomUUID(),
    amount,
    currency,
    status: body.status === 'COMPLETED' ? 'succeeded' : 'pending',
    gateway: 'paypal',
    metadata: metadata || {},
  };
}

async function processWorldpayPayment(
  tenantId: TenantId,
  amount: number,
  currency: string,
  paymentMethodId: string,
  metadata?: Record<string, unknown>
): Promise<PaymentIntent> {
  // Worldpay integration (simplified)
  logger.info('Worldpay payment processing', { tenantId, amount, paymentMethodId });
  // In production, would call Worldpay API
  return {
    id: crypto.randomUUID(),
    amount,
    currency,
    status: 'pending',
    gateway: 'worldpay',
    metadata: metadata || {},
  };
}

async function processSagepayPayment(
  tenantId: TenantId,
  amount: number,
  currency: string,
  paymentMethodId: string,
  metadata?: Record<string, unknown>
): Promise<PaymentIntent> {
  // Sagepay integration (simplified)
  logger.info('Sagepay payment processing', { tenantId, amount, paymentMethodId });
  // In production, would call Sagepay API
  return {
    id: crypto.randomUUID(),
    amount,
    currency,
    status: 'pending',
    gateway: 'sagepay',
    metadata: metadata || {},
  };
}

async function processBraintreePayment(
  tenantId: TenantId,
  amount: number,
  currency: string,
  paymentMethodId: string,
  metadata?: Record<string, unknown>
): Promise<PaymentIntent> {
  logger.info('Braintree payment processing', { tenantId, amount });

  const merchantId = process.env.BRAINTREE_MERCHANT_ID;
  if (!merchantId) {
    throw new Error('BRAINTREE_MERCHANT_ID not configured');
  }

  const intentId = crypto.randomUUID();
  // In production this would call the Braintree SDK. Here we simulate a pending intent for downstream confirmation.
  return {
    id: intentId,
    amount,
    currency,
    status: 'pending',
    gateway: 'braintree',
    metadata: {
      tenantId,
      merchantId,
      paymentMethodId,
      ...metadata,
    },
  };
}
