import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('stripe-commerce');

export interface StripeConfig {
  apiKey: string;
  webhookSecret: string;
  environment: 'test' | 'live';
}

export interface StripeCharge {
  id: string;
  amount: number;
  currency: string;
  created: number;
  status: string;
  customer?: string;
  description?: string;
  metadata: Record<string, string>;
}

export interface StripePayout {
  id: string;
  amount: number;
  currency: string;
  arrival_date: number;
  status: string;
  type: string;
  summary: {
    charge_count: number;
    charge_gross: number;
    charge_fees: number;
    charge_net: number;
    refund_count: number;
    refund_gross: number;
    refund_fees: number;
    refund_net: number;
    adjustment_count: number;
    adjustment_gross: number;
    adjustment_fees: number;
    adjustment_net: number;
  };
}

export class StripeService {
  private config: StripeConfig;
  private baseUrl: string;

  constructor(config: StripeConfig) {
    this.config = config;
    this.baseUrl = 'https://api.stripe.com/v1';
  }

  /**
   * Get charges
   */
  async getCharges(created?: { gte?: number; lte?: number }, limit: number = 100): Promise<StripeCharge[]> {
    try {
      const params = new URLSearchParams();
      if (created?.gte) params.append('created[gte]', String(created.gte));
      if (created?.lte) params.append('created[lte]', String(created.lte));
      params.append('limit', String(limit));

      const response = await fetch(`${this.baseUrl}/charges?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Stripe API error: ${error.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      logger.error('Failed to get Stripe charges', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get payouts
   */
  async getPayouts(created?: { gte?: number; lte?: number }, limit: number = 100): Promise<StripePayout[]> {
    try {
      const params = new URLSearchParams();
      if (created?.gte) params.append('created[gte]', String(created.gte));
      if (created?.lte) params.append('created[lte]', String(created.lte));
      params.append('limit', String(limit));

      const response = await fetch(`${this.baseUrl}/payouts?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Stripe API error: ${error.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.data || [];
    } catch (error) {
      logger.error('Failed to get Stripe payouts', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    // In production, use crypto to verify HMAC signature
    // For now, return true (would implement proper verification)
    return true;
  }

  /**
   * Handle webhook
   */
  async handleWebhook(event: {
    id: string;
    type: string;
    data: {
      object: Record<string, unknown>;
    };
  }): Promise<void> {
    logger.info('Stripe webhook received', {
      eventId: event.id,
      type: event.type,
    });

    // Handle different event types
    switch (event.type) {
      case 'charge.succeeded':
      case 'charge.updated':
        logger.info('Charge event', { chargeId: (event.data.object as any).id });
        // Trigger charge sync
        break;

      case 'payout.paid':
        logger.info('Payout paid', { payoutId: (event.data.object as any).id });
        // Trigger payout sync
        break;

      default:
        logger.warn('Unknown Stripe event type', { type: event.type });
    }
  }
}

export function createStripeService(config: StripeConfig): StripeService {
  return new StripeService(config);
}
