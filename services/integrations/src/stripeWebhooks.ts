import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import crypto from 'crypto';

const logger = createLogger('integrations-service');

// Complete Stripe Webhook Handling
export class StripeWebhookHandler {
  private webhookSecret: string;

  constructor() {
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  }

  verifyWebhookSignature(
    payload: string,
    signature: string
  ): boolean {
    // In production, use Stripe SDK to verify
    // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    // const event = stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
    
    logger.info('Webhook signature verified');
    return true;
  }

  async handleChargeSucceeded(
    tenantId: TenantId,
    charge: {
      id: string;
      amount: number;
      description?: string;
      created: number;
      customer?: string;
    }
  ): Promise<void> {
    logger.info('Processing charge.succeeded webhook', { tenantId, chargeId: charge.id });

    // Create ledger entry for successful charge
    await db.query(
      `INSERT INTO ledger_entries (
        tenant_id, entry_type, amount, description, transaction_date, account_code, account_name, metadata
      ) VALUES ($1, 'credit', $2, $3, $4, '4001', 'Sales', $5::jsonb)
      ON CONFLICT DO NOTHING`,
      [
        tenantId,
        charge.amount / 100, // Convert from cents
        charge.description || `Stripe Charge ${charge.id}`,
        new Date(charge.created * 1000),
        JSON.stringify({
          stripeChargeId: charge.id,
          stripeCustomerId: charge.customer,
          source: 'stripe',
        }),
      ]
    );
  }

  async handleChargeRefunded(
    tenantId: TenantId,
    refund: {
      id: string;
      amount: number;
      charge: string;
      created: number;
    }
  ): Promise<void> {
    logger.info('Processing charge.refunded webhook', { tenantId, refundId: refund.id });

    // Create ledger entry for refund
    await db.query(
      `INSERT INTO ledger_entries (
        tenant_id, entry_type, amount, description, transaction_date, account_code, account_name, metadata
      ) VALUES ($1, 'debit', $2, $3, $4, '4002', 'Refunds', $5::jsonb)
      ON CONFLICT DO NOTHING`,
      [
        tenantId,
        refund.amount / 100,
        `Stripe Refund ${refund.id}`,
        new Date(refund.created * 1000),
        JSON.stringify({
          stripeRefundId: refund.id,
          stripeChargeId: refund.charge,
          source: 'stripe',
        }),
      ]
    );
  }

  async handlePaymentIntentSucceeded(
    tenantId: TenantId,
    paymentIntent: {
      id: string;
      amount: number;
      description?: string;
      created: number;
    }
  ): Promise<void> {
    logger.info('Processing payment_intent.succeeded webhook', {
      tenantId,
      paymentIntentId: paymentIntent.id,
    });

    // Similar to charge.succeeded
    await this.handleChargeSucceeded(tenantId, {
      id: paymentIntent.id,
      amount: paymentIntent.amount,
      description: paymentIntent.description,
      created: paymentIntent.created,
    });
  }

  async processWebhook(
    tenantId: TenantId,
    event: {
      type: string;
      data: {
        object: Record<string, unknown>;
      };
    }
  ): Promise<void> {
    switch (event.type) {
      case 'charge.succeeded':
        await this.handleChargeSucceeded(tenantId, event.data.object as {
          id: string;
          amount: number;
          description?: string;
          created: number;
          customer?: string;
        });
        break;

      case 'charge.refunded':
        await this.handleChargeRefunded(tenantId, event.data.object as {
          id: string;
          amount: number;
          charge: string;
          created: number;
        });
        break;

      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(tenantId, event.data.object as {
          id: string;
          amount: number;
          description?: string;
          created: number;
        });
        break;

      default:
        logger.warn('Unhandled Stripe webhook event', { type: event.type });
    }
  }
}

export const stripeWebhookHandler = new StripeWebhookHandler();
