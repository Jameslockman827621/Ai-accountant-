import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import Stripe from 'stripe';
import axios from 'axios';

const logger = createLogger('billing-service');

export type PaymentGateway = 'stripe' | 'paypal' | 'worldpay' | 'sagepay';

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
  const response = await axios.post(
    'https://api.paypal.com/v2/payments/captures',
    {
      amount: {
        value: amount.toFixed(2),
        currency_code: currency,
      },
      payment_method: paymentMethodId,
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.PAYPAL_ACCESS_TOKEN}`,
      },
    }
  );

  return {
    id: response.data.id,
    amount,
    currency,
    status: response.data.status === 'COMPLETED' ? 'succeeded' : 'pending',
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
  logger.info('Worldpay payment processing', { tenantId, amount });
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
  logger.info('Sagepay payment processing', { tenantId, amount });
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
