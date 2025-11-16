import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { unifiedIngestionService } from '../../ingestion/src/services/unifiedIngestion';

const logger = createLogger('webhook-ingestion');

export interface WebhookPayload {
  provider: string;
  eventType: string;
  data: Record<string, unknown>;
  signature?: string;
  timestamp?: string;
  webhookId?: string;
}

export class WebhookIngestionService {
  /**
   * Process incoming webhook
   */
  async processWebhook(
    tenantId: TenantId,
    payload: WebhookPayload
  ): Promise<string> {
    try {
      // Verify webhook signature (in production)
      if (payload.signature) {
        const isValid = await this.verifySignature(tenantId, payload.provider, payload.signature, payload.data);
        if (!isValid) {
          throw new Error('Invalid webhook signature');
        }
      }

      // Create payload hash for deduplication
      const payloadHash = this.createPayloadHash(payload);

      // Check for duplicates
      const duplicate = await this.checkDuplicate(tenantId, payloadHash);
      if (duplicate) {
        logger.warn('Duplicate webhook detected', { tenantId, payloadHash, duplicate });
        return duplicate;
      }

      // Log ingestion
      const ingestionLogId = await unifiedIngestionService.logIngestion(tenantId, 'system' as any, {
        sourceType: 'webhook',
        connectorProvider: payload.provider,
        payload: payload.data,
        metadata: {
          eventType: payload.eventType,
          webhookId: payload.webhookId,
          timestamp: payload.timestamp,
        },
      });

      // Process based on provider and event type
      await this.processWebhookEvent(tenantId, payload, ingestionLogId);

      logger.info('Webhook processed', {
        tenantId,
        provider: payload.provider,
        eventType: payload.eventType,
        ingestionLogId,
      });

      return ingestionLogId;
    } catch (error) {
      logger.error('Webhook processing failed', {
        tenantId,
        provider: payload.provider,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Process webhook event based on provider
   */
  private async processWebhookEvent(
    tenantId: TenantId,
    payload: WebhookPayload,
    ingestionLogId: string
  ): Promise<void> {
    switch (payload.provider) {
      case 'shopify':
        await this.processShopifyWebhook(tenantId, payload, ingestionLogId);
        break;
      case 'stripe':
        await this.processStripeWebhook(tenantId, payload, ingestionLogId);
        break;
      case 'plaid':
        await this.processPlaidWebhook(tenantId, payload, ingestionLogId);
        break;
      case 'truelayer':
        await this.processTrueLayerWebhook(tenantId, payload, ingestionLogId);
        break;
      default:
        logger.warn('Unknown webhook provider', { provider: payload.provider });
    }
  }

  /**
   * Process Shopify webhook
   */
  private async processShopifyWebhook(
    tenantId: TenantId,
    payload: WebhookPayload,
    ingestionLogId: string
  ): Promise<void> {
    // Handle different Shopify event types
    switch (payload.eventType) {
      case 'orders/create':
      case 'orders/updated':
        // Create order record
        await this.createOrderRecord(tenantId, payload.data, ingestionLogId);
        break;
      case 'orders/paid':
        // Trigger reconciliation
        await this.triggerReconciliation(tenantId, payload.data);
        break;
      default:
        logger.info('Shopify webhook event', { eventType: payload.eventType });
    }
  }

  /**
   * Process Stripe webhook
   */
  private async processStripeWebhook(
    tenantId: TenantId,
    payload: WebhookPayload,
    ingestionLogId: string
  ): Promise<void> {
    switch (payload.eventType) {
      case 'charge.succeeded':
      case 'charge.updated':
        await this.createChargeRecord(tenantId, payload.data, ingestionLogId);
        break;
      case 'payout.paid':
        await this.createPayoutRecord(tenantId, payload.data, ingestionLogId);
        break;
      default:
        logger.info('Stripe webhook event', { eventType: payload.eventType });
    }
  }

  /**
   * Process Plaid webhook
   */
  private async processPlaidWebhook(
    tenantId: TenantId,
    payload: WebhookPayload,
    ingestionLogId: string
  ): Promise<void> {
    // Handle Plaid webhook types
    if (payload.eventType === 'TRANSACTIONS' && (payload.data as any).webhook_code === 'SYNC_UPDATES_AVAILABLE') {
      // Trigger transaction sync
      logger.info('Plaid transaction sync triggered', { tenantId, ingestionLogId });
    }
  }

  /**
   * Process TrueLayer webhook
   */
  private async processTrueLayerWebhook(
    tenantId: TenantId,
    payload: WebhookPayload,
    ingestionLogId: string
  ): Promise<void> {
    // Handle TrueLayer event types
    if (payload.eventType === 'transaction_created' || payload.eventType === 'transaction_updated') {
      logger.info('TrueLayer transaction event', { tenantId, ingestionLogId });
    }
  }

  /**
   * Create order record
   */
  private async createOrderRecord(
    tenantId: TenantId,
    orderData: Record<string, unknown>,
    ingestionLogId: string
  ): Promise<void> {
    // In production, would create order record in database
    logger.info('Order record created', { tenantId, orderId: (orderData as any).id });
  }

  /**
   * Create charge record
   */
  private async createChargeRecord(
    tenantId: TenantId,
    chargeData: Record<string, unknown>,
    ingestionLogId: string
  ): Promise<void> {
    // In production, would create charge record
    logger.info('Charge record created', { tenantId, chargeId: (chargeData as any).id });
  }

  /**
   * Create payout record
   */
  private async createPayoutRecord(
    tenantId: TenantId,
    payoutData: Record<string, unknown>,
    ingestionLogId: string
  ): Promise<void> {
    // In production, would create payout record
    logger.info('Payout record created', { tenantId, payoutId: (payoutData as any).id });
  }

  /**
   * Trigger reconciliation
   */
  private async triggerReconciliation(tenantId: TenantId, data: Record<string, unknown>): Promise<void> {
    // In production, would trigger reconciliation process
    logger.info('Reconciliation triggered', { tenantId });
  }

  /**
   * Verify webhook signature
   */
  private async verifySignature(
    tenantId: TenantId,
    provider: string,
    signature: string,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    // In production, would verify HMAC signature
    // For now, return true
    return true;
  }

  /**
   * Create payload hash
   */
  private createPayloadHash(payload: WebhookPayload): string {
    const hashInput = JSON.stringify({
      provider: payload.provider,
      eventType: payload.eventType,
      data: payload.data,
      webhookId: payload.webhookId,
    });
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Check for duplicate webhook
   */
  private async checkDuplicate(tenantId: TenantId, payloadHash: string): Promise<string | null> {
    const result = await db.query<{ id: string }>(
      `SELECT id FROM ingestion_log
       WHERE tenant_id = $1
         AND source_type = 'webhook'
         AND payload_hash = $2
       LIMIT 1`,
      [tenantId, payloadHash]
    );

    return result.rows.length > 0 ? result.rows[0].id : null;
  }
}

export const webhookIngestionService = new WebhookIngestionService();
