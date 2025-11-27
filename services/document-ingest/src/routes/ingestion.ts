import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { emailIngestionService, EmailMessage } from '../services/emailIngestion';
import { webhookIngestionService, WebhookPayload } from '../services/webhookIngestion';
import { emailAliasesService } from '../services/emailAliases';
import { ingestionRulesService } from '../services/ingestionRules';
import { dkimValidator } from '../services/dkimValidation';
import { ValidationError } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { publishOCRJob } from '../messaging/queue';
import { DocumentStatus } from '@ai-accountant/shared-types';
import { recordDocumentStageTransition } from '../services/documentWorkflow';
import { webhookSecurityService } from '../../ingestion/src/services/webhookSecurity';
import { unifiedIngestionService } from '../../ingestion/src/services/unifiedIngestion';

const router = Router();
const logger = createLogger('ingestion-routes');

// Email inbound webhook (Chunk 1) - Public endpoint
router.post('/email/inbound', async (req: any, res: Response) => {
  try {
    // This endpoint is public (no auth) - validated via DKIM and secret token
    const { to, from, subject, body, html, attachments, headers } = req.body;

    const apiKey = (req.headers['x-api-key'] as string) || (req.headers['x-ingestion-key'] as string);
    if (!apiKey) {
      res.status(401).json({ error: 'Missing ingestion API key' });
      return;
    }

    const apiKeyResult = await webhookSecurityService.verifyApiKey(apiKey);
    if (!apiKeyResult.isValid || !apiKeyResult.tenantId) {
      res.status(401).json({ error: 'Invalid ingestion API key' });
      return;
    }

    if (!to || !from || !subject) {
      throw new ValidationError('Missing required email fields');
    }

    // Verify DKIM signature
    const dkimValid = await dkimValidator.verifyDKIMSignature(
      headers || {},
      body || html || ''
    );

    if (!dkimValid) {
      logger.warn('DKIM validation failed', { to, from });
      // In production, might want to reject or flag suspicious emails
      // For now, we'll log and continue
    }

    // Find tenant by email alias and ensure it belongs to the API key tenant
    const alias = await emailAliasesService.getAliasByEmail(to);
    if (!alias || alias.tenantId !== apiKeyResult.tenantId) {
      logger.warn('Email alias not found or unauthorized', { to });
      res.status(404).json({ error: 'Email alias not found' });
      return;
    }

    // Mark alias as used
    await emailAliasesService.markAliasUsed(alias.id);

    // Build email message
    const emailMessage: EmailMessage = {
      from,
      to,
      subject,
      body: body || '',
      html,
      attachments: attachments?.map((att: any) => ({
        filename: att.filename,
        contentType: att.contentType,
        content: Buffer.from(att.content, 'base64'),
      })),
      headers: headers || {},
    };

    // Process email
    const ingestionLogId = await emailIngestionService.processEmail(alias.tenantId, emailMessage);

    // Persist minimal ingestion marker for auditing
    await unifiedIngestionService.updateIngestionStatus(ingestionLogId, 'processing', {
      processingLatency: 0,
    });

    res.json({ message: 'Email processed', ingestionLogId });
  } catch (error) {
    logger.error('Email inbound processing failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to process email' });
  }
});

// Generic webhook handler (Chunk 1) - Public endpoint
router.post('/webhooks/:source', async (req: any, res: Response) => {
  try {
    const { source } = req.params;
    const webhookData = req.body;
    const signature = (req.headers['x-webhook-signature'] as string) ||
                     (req.headers['x-signature'] as string);
    const apiKeyHeader = (req.headers['x-api-key'] as string) || (req.headers['x-ingestion-key'] as string);

    // Get tenant ID from auth or webhook secret
    let tenantId: string;
    if (req.user) {
      tenantId = req.user.tenantId;
    } else {
      if (!apiKeyHeader) {
        throw new ValidationError('Authentication required or valid webhook secret');
      }
      const apiKeyResult = await webhookSecurityService.verifyApiKey(apiKeyHeader);
      if (!apiKeyResult.isValid || !apiKeyResult.tenantId) {
        throw new ValidationError(apiKeyResult.error || 'Invalid webhook credentials');
      }
      tenantId = apiKeyResult.tenantId;
    }

    // Build webhook payload
    const payload: WebhookPayload = {
      provider: source,
      eventType: webhookData.eventType || webhookData.type || 'unknown',
      data: webhookData.data || webhookData,
      signature,
      timestamp: webhookData.timestamp || new Date().toISOString(),
      webhookId: webhookData.webhookId || webhookData.id,
    };

    // Validate signature when present
    if (signature && !webhookSecurityService.verifyHMAC(source, signature, JSON.stringify(payload.data), process.env.WEBHOOK_SIGNING_SECRET || '')) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    // Process webhook
    const ingestionLogId = await webhookIngestionService.processWebhook(tenantId, payload);

    // Log to ingestion_log for dedupe/traceability
    await db.query(
      `INSERT INTO ingestion_log (
        id, tenant_id, source_type, connector_provider, payload, metadata, created_at
      ) VALUES (
        gen_random_uuid(), $1, 'webhook', $2, $3::jsonb, $4::jsonb, NOW()
      ) ON CONFLICT DO NOTHING`,
      [
        tenantId,
        source,
        JSON.stringify(payload.data),
        JSON.stringify({
          eventType: payload.eventType,
          webhookId: payload.webhookId,
          timestamp: payload.timestamp,
          signatureValid: Boolean(signature),
        }),
      ]
    );

    res.json({ message: 'Webhook processed', ingestionLogId });
  } catch (error) {
    logger.error('Webhook processing failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Get email aliases (Chunk 1)
router.get('/email/aliases', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const aliases = await emailAliasesService.getTenantAliases(req.user.tenantId);
    res.json({ aliases });
  } catch (error) {
    logger.error('Get email aliases failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get email aliases' });
  }
});

// Create email alias (Chunk 1)
router.post('/email/aliases', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { expiresInDays } = req.body;
    const alias = await emailAliasesService.createAlias(
      req.user.tenantId,
      req.user.userId,
      expiresInDays || 365
    );

    res.status(201).json({ alias });
  } catch (error) {
    logger.error('Create email alias failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to create email alias' });
  }
});

// Delete email alias (Chunk 1)
router.delete('/email/aliases/:aliasId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { aliasId } = req.params;
    await emailAliasesService.deleteAlias(aliasId, req.user.tenantId);

    res.json({ message: 'Alias deleted' });
  } catch (error) {
    logger.error('Delete email alias failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to delete email alias' });
  }
});

// Get ingestion rules (Chunk 1)
router.get('/rules', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rules = await ingestionRulesService.getEnabledRules(req.user.tenantId);
    res.json({ rules });
  } catch (error) {
    logger.error('Get ingestion rules failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get ingestion rules' });
  }
});

// Create ingestion rule (Chunk 1)
router.post('/rules', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      ruleName,
      ruleType,
      priority,
      sourceType,
      sourcePattern,
      conditions,
      actions,
      targetClassification,
      targetWorkflow,
    } = req.body;

    if (!ruleName || !ruleType) {
      throw new ValidationError('Rule name and type are required');
    }

    const ruleId = await ingestionRulesService.createRule(
      req.user.tenantId,
      req.user.userId,
      {
        ruleName,
        ruleType,
        priority: priority || 0,
        sourceType,
        sourcePattern,
        conditions: conditions || {},
        actions: actions || {},
        targetClassification,
        targetWorkflow,
      }
    );

    res.status(201).json({ ruleId });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Create ingestion rule failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to create ingestion rule' });
  }
});

// CSV dropzone - get signed URL (Chunk 1)
router.post('/csv/signed-url', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { fileName, fileSize } = req.body;

    if (!fileName) {
      throw new ValidationError('File name is required');
    }

    // Generate S3 path
    const documentId = require('crypto').randomUUID();
    const storageKey = `csv-dropzone/${req.user.tenantId}/${documentId}/${fileName}`;

    // In production, would generate signed URL for S3 upload
    // For now, return the storage key
    const signedUrl = `${process.env.S3_BUCKET_URL || 'https://s3.example.com'}/${storageKey}`;

    res.json({
      signedUrl,
      storageKey,
      documentId,
      expiresIn: 3600, // 1 hour
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Get signed URL failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get signed URL' });
  }
});

// CSV dropzone - process uploaded file (Chunk 1)
router.post('/csv/process', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { storageKey, documentId } = req.body;

    if (!storageKey || !documentId) {
      throw new ValidationError('Storage key and document ID are required');
    }

    // Create document record
    await db.query(
      `INSERT INTO documents (
        id, tenant_id, uploaded_by, file_name, file_type, file_size,
        storage_key, status, upload_source, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
      )`,
      [
        documentId,
        req.user.tenantId,
        req.user.userId,
        storageKey.split('/').pop() || 'upload.csv',
        'text/csv',
        0, // Size will be updated after processing
        storageKey,
        DocumentStatus.UPLOADED,
        'csv',
      ]
    );

    await recordDocumentStageTransition({
      documentId,
      tenantId: req.user.tenantId,
      toStatus: DocumentStatus.UPLOADED,
      trigger: 'csv_upload',
      metadata: { userId: req.user.userId },
      updateDocumentStatus: false,
    });

    // Evaluate ingestion rules
    const rulesResult = await ingestionRulesService.evaluateRules(req.user.tenantId, {
      sourceType: 'csv',
      fileType: 'text/csv',
    });

    // Publish OCR job
    await publishOCRJob(documentId, storageKey, {
      tenantId: req.user.tenantId,
      headers: {
        'x-trigger': 'csv_upload',
        'x-routing': JSON.stringify(rulesResult),
      },
    });

    await recordDocumentStageTransition({
      documentId,
      tenantId: req.user.tenantId,
      toStatus: DocumentStatus.PROCESSING,
      trigger: 'ocr_enqueued',
      metadata: { source: 'csv_upload' },
    });

    res.json({ message: 'CSV file queued for processing', documentId });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Process CSV failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to process CSV' });
  }
});

export { router as ingestionRouter };
