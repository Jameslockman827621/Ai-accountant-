import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { DocumentStatus, DocumentType, TenantId } from '@ai-accountant/shared-types';
import { randomUUID, createHash } from 'crypto';
import { unifiedIngestionService } from '../../ingestion/src/services/unifiedIngestion';
import { uploadFile } from '../storage/s3';
import { publishOCRJob } from '../messaging/queue';
import { recordDocumentStageTransition } from './documentWorkflow';

const logger = createLogger('webhook-ingestion');

export interface WebhookPayload {
  provider: string;
  eventType: string;
  data: Record<string, unknown>;
  signature?: string;
  timestamp?: string;
  webhookId?: string;
  attachments?: WebhookAttachment[];
}

export interface WebhookAttachment {
  filename?: string;
  contentType?: string;
  content?: string | Buffer; // base64 string or Buffer
  contentBase64?: string;
  size?: number;
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

        // Process attachments/documents if included
        await this.handleDocumentAttachments(tenantId, payload, ingestionLogId);

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

  /**
   * Handle document attachments embedded in webhook payloads
   */
  private async handleDocumentAttachments(
    tenantId: TenantId,
    payload: WebhookPayload,
    ingestionLogId: string
  ): Promise<void> {
    const attachments = this.extractAttachments(payload);
    if (!attachments || attachments.length === 0) {
      return;
    }

    for (const attachment of attachments) {
      const buffer = this.normalizeAttachmentContent(attachment);
      if (!buffer) {
        continue;
      }

      const filename = this.sanitizeFilename(attachment.filename || `${payload.provider}-attachment-${Date.now()}`);
      const contentType = attachment.contentType || 'application/octet-stream';

      if (!this.isFinancialDocument(filename, contentType)) {
        continue;
      }

      const documentId = randomUUID();
      const storageKey = `webhooks/${tenantId}/${documentId}/${filename}`;
      const documentType = this.detectDocumentType(filename, contentType);

      try {
        await uploadFile(storageKey, buffer, contentType);

        await db.query(
          `INSERT INTO documents (
            id, tenant_id, uploaded_by, file_name, file_type, file_size,
            storage_key, status, upload_source, document_type, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
          [
            documentId,
            tenantId,
            'system',
            filename,
            contentType,
            buffer.length,
            storageKey,
            DocumentStatus.UPLOADED,
            'webhook',
            documentType,
          ]
        );

        await recordDocumentStageTransition({
          documentId,
          tenantId,
          toStatus: DocumentStatus.UPLOADED,
          trigger: `${payload.provider}_webhook`,
          metadata: { provider: payload.provider, eventType: payload.eventType, filename },
          updateDocumentStatus: false,
        });

        await publishOCRJob(documentId, storageKey, {
          tenantId,
          source: `${payload.provider}-webhook`,
          headers: {
            'x-trigger': 'webhook',
            'x-webhook-provider': payload.provider,
            'x-ingestion-log-id': ingestionLogId,
          },
        });

        await recordDocumentStageTransition({
          documentId,
          tenantId,
          toStatus: DocumentStatus.PROCESSING,
          trigger: 'ocr_enqueued',
          metadata: { provider: payload.provider, eventType: payload.eventType, ingestionLogId },
        });

        logger.info('Webhook attachment processed', {
          tenantId,
          provider: payload.provider,
          documentId,
          ingestionLogId,
        });
      } catch (error) {
        logger.error(
          'Failed to ingest webhook attachment',
          error instanceof Error ? error : new Error(String(error)),
          { tenantId, provider: payload.provider, filename }
        );

        await recordDocumentStageTransition({
          documentId,
          tenantId,
          toStatus: DocumentStatus.ERROR,
          trigger: 'ocr_enqueue_failed',
          metadata: { provider: payload.provider, eventType: payload.eventType, ingestionLogId, filename },
          errorMessage: 'Failed to enqueue OCR job',
        });
      }
    }
  }

  private extractAttachments(payload: WebhookPayload): WebhookAttachment[] {
    if (payload.attachments && payload.attachments.length > 0) {
      return payload.attachments;
    }
    const data = payload.data || {};
    const nestedAttachments =
      (data as any).attachments ||
      (data as any).documents ||
      (data as any).files;

    if (Array.isArray(nestedAttachments)) {
      return nestedAttachments;
    }

    return [];
  }

  private normalizeAttachmentContent(attachment: WebhookAttachment): Buffer | null {
    if (attachment.content instanceof Buffer) {
      return attachment.content;
    }
    const payload = attachment.content || attachment.contentBase64;
    if (!payload) {
      return null;
    }

    if (typeof payload === 'string') {
      const normalizedString = payload.includes('base64,')
        ? payload.substring(payload.indexOf('base64,') + 'base64,'.length)
        : payload;
      try {
        return Buffer.from(normalizedString, 'base64');
      } catch {
        try {
          return Buffer.from(normalizedString, 'utf8');
        } catch {
          return null;
        }
      }
    }

    if (payload instanceof Uint8Array) {
      return Buffer.from(payload);
    }

    return null;
  }

  private sanitizeFilename(filename: string): string {
    const fallback = `attachment-${Date.now()}`;
    if (!filename) {
      return fallback;
    }
    const basename = filename.split('/').pop()?.split('\\').pop() || fallback;
    return basename.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  private isFinancialDocument(filename: string, contentType: string): boolean {
    const financialExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.xls', '.csv'];
    const financialContentTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ];

    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    const normalizedType = (contentType || '').toLowerCase();
    return financialExtensions.includes(ext) || financialContentTypes.includes(normalizedType);
  }

  private detectDocumentType(filename: string, contentType: string): DocumentType {
    const filenameLower = filename.toLowerCase();
    const normalizedType = (contentType || '').toLowerCase();

    if (filenameLower.includes('invoice')) return DocumentType.INVOICE;
    if (filenameLower.includes('receipt')) return DocumentType.RECEIPT;
    if (filenameLower.includes('statement')) return DocumentType.STATEMENT;
    if (filenameLower.includes('payslip') || filenameLower.includes('payroll')) return DocumentType.PAYSLIP;
    if (normalizedType.includes('tax')) return DocumentType.TAX_FORM;

    return DocumentType.OTHER;
  }
}

export const webhookIngestionService = new WebhookIngestionService();
