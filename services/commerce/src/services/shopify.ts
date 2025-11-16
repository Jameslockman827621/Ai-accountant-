import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('shopify-commerce');

export interface ShopifyConfig {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
}

export interface ShopifyOrder {
  id: string;
  order_number: number;
  created_at: string;
  updated_at: string;
  total_price: string;
  subtotal_price: string;
  total_tax: string;
  currency: string;
  financial_status: string;
  line_items: Array<{
    id: string;
    title: string;
    quantity: number;
    price: string;
    sku?: string;
  }>;
  customer?: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  };
  shipping_address?: {
    country: string;
    province: string;
    city: string;
  };
}

export interface ShopifyPayout {
  id: string;
  status: string;
  date: string;
  currency: string;
  amount: string;
  summary: {
    charges_count: number;
    charges_gross_amount: string;
    charges_fee_amount: string;
    charges_net_amount: string;
    adjustments_count: number;
    adjustments_gross_amount: string;
    adjustments_fee_amount: string;
    adjustments_net_amount: string;
    refunds_count: number;
    refunds_gross_amount: string;
    refunds_fee_amount: string;
    refunds_net_amount: string;
    reserved_funds_count: number;
    reserved_funds_gross_amount: string;
    reserved_funds_fee_amount: string;
    reserved_funds_net_amount: string;
    retried_payouts_count: number;
    retried_payouts_gross_amount: string;
    retried_payouts_fee_amount: string;
    retried_payouts_net_amount: string;
  };
}

export class ShopifyService {
  private config: ShopifyConfig;
  private baseUrl: string;

  constructor(config: ShopifyConfig) {
    this.config = config;
    this.baseUrl = `https://${config.shopDomain}/admin/api/${config.apiVersion}`;
  }

  /**
   * Get orders
   */
  async getOrders(createdAtMin?: string, createdAtMax?: string, limit: number = 250): Promise<ShopifyOrder[]> {
    try {
      const params = new URLSearchParams();
      if (createdAtMin) params.append('created_at_min', createdAtMin);
      if (createdAtMax) params.append('created_at_max', createdAtMax);
      params.append('limit', String(limit));
      params.append('status', 'any'); // Get all orders including cancelled

      const response = await fetch(`${this.baseUrl}/orders.json?${params.toString()}`, {
        headers: {
          'X-Shopify-Access-Token': this.config.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Shopify API error: ${error.errors || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.orders || [];
    } catch (error) {
      logger.error('Failed to get Shopify orders', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Get payouts
   */
  async getPayouts(startDate?: string, endDate?: string): Promise<ShopifyPayout[]> {
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('since_id', startDate);
      if (endDate) params.append('last_id', endDate);

      const response = await fetch(`${this.baseUrl}/shopify_payments/payouts.json?${params.toString()}`, {
        headers: {
          'X-Shopify-Access-Token': this.config.accessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Shopify API error: ${error.errors || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.payouts || [];
    } catch (error) {
      logger.error('Failed to get Shopify payouts', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Handle webhook
   */
  async handleWebhook(webhookData: {
    id: string;
    topic: string;
    [key: string]: unknown;
  }): Promise<void> {
    logger.info('Shopify webhook received', {
      webhookId: webhookData.id,
      topic: webhookData.topic,
    });

    // Handle different webhook topics
    switch (webhookData.topic) {
      case 'orders/create':
      case 'orders/updated':
        logger.info('Order webhook', { orderId: (webhookData as any).id });
        // Trigger order sync
        break;

      case 'orders/paid':
        logger.info('Order paid', { orderId: (webhookData as any).id });
        // Trigger reconciliation
        break;

      default:
        logger.warn('Unknown Shopify webhook topic', { topic: webhookData.topic });
    }
  }
}

export function createShopifyService(config: ShopifyConfig): ShopifyService {
  return new ShopifyService(config);
}
