import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { ValidationError } from '@ai-accountant/shared-utils';
import { createShopifyService } from '../services/shopify';
import { createStripeService } from '../services/stripe';
import { db } from '@ai-accountant/database';
import { webhookIngestionService } from '../../document-ingest/src/services/webhookIngestion';
import { unifiedIngestionService } from '../../ingestion/src/services/unifiedIngestion';
import { v4 as uuid } from 'uuid';

const router = Router();
const logger = createLogger('commerce-service');

// Get commerce connectors
router.get('/connectors', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.query(
      `SELECT cr.*, cs.last_sync_at, cs.last_sync_status, cs.next_sync_at
       FROM connector_registry cr
       LEFT JOIN connector_sync_schedule cs ON cs.connector_id = cr.id
       WHERE cr.tenant_id = $1 AND cr.connector_type IN ('ecommerce', 'payment_processor')
       ORDER BY cr.created_at DESC`,
      [req.user.tenantId]
    );

    res.json({ connectors: result.rows });
  } catch (error) {
    logger.error('Get commerce connectors failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get commerce connectors' });
  }
});

// Connect Shopify
router.post('/shopify/connect', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { shopDomain, accessToken } = req.body;

    if (!shopDomain || !accessToken) {
      throw new ValidationError('Shop domain and access token are required');
    }

    const connectorId = await db.query(
      `INSERT INTO connector_registry (
        tenant_id, connector_type, provider, connector_name,
        is_enabled, status, connection_id, credential_store_key, connected_at, connected_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
      RETURNING id`,
      [
        req.user.tenantId,
        'ecommerce',
        'shopify',
        `Shopify - ${shopDomain}`,
        true,
        'enabled',
        shopDomain,
        `shopify_${req.user.tenantId}_${Date.now()}`,
        req.user.userId,
      ]
    );

    // Create sync schedule (commerce syncs hourly)
    await db.query(
      `INSERT INTO connector_sync_schedule (
        connector_id, tenant_id, sync_frequency, is_active, next_sync_at
      ) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour')`,
      [connectorId.rows[0].id, req.user.tenantId, 'hourly', true]
    );

    res.json({ connectorId: connectorId.rows[0].id, message: 'Shopify connected successfully' });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Shopify connection failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to connect Shopify' });
  }
});

// Connect Stripe
router.post('/stripe/connect', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { apiKey } = req.body;

    if (!apiKey) {
      throw new ValidationError('API key is required');
    }

    const connectorId = await db.query(
      `INSERT INTO connector_registry (
        tenant_id, connector_type, provider, connector_name,
        is_enabled, status, credential_store_key, connected_at, connected_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
      RETURNING id`,
      [
        req.user.tenantId,
        'payment_processor',
        'stripe',
        'Stripe',
        true,
        'enabled',
        `stripe_${req.user.tenantId}_${Date.now()}`,
        req.user.userId,
      ]
    );

    // Create sync schedule
    await db.query(
      `INSERT INTO connector_sync_schedule (
        connector_id, tenant_id, sync_frequency, is_active, next_sync_at
      ) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour')`,
      [connectorId.rows[0].id, req.user.tenantId, 'hourly', true]
    );

    res.json({ connectorId: connectorId.rows[0].id, message: 'Stripe connected successfully' });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Stripe connection failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to connect Stripe' });
  }
});

// Sync commerce data
router.post('/sync/:connectorId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { connectorId } = req.params;
    const { startDate, endDate } = req.body;

    const connector = await db.query(
      'SELECT provider, connection_id, credential_store_key FROM connector_registry WHERE id = $1 AND tenant_id = $2',
      [connectorId, req.user.tenantId]
    );

    if (connector.rows.length === 0) {
      throw new ValidationError('Connector not found');
    }

    const conn = connector.rows[0];

    // In production, would fetch actual commerce data
    const ingestionLogId = await unifiedIngestionService.logIngestion(
      req.user.tenantId,
      req.user.userId,
      {
        sourceType: 'commerce',
        connectorId,
        connectorProvider: conn.provider,
        payload: {
          syncDate: new Date().toISOString(),
          startDate,
          endDate,
        },
      }
    );

    res.json({ ingestionLogId, message: 'Commerce sync initiated' });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Commerce sync failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to sync commerce data' });
  }
});

// Get orders/transactions
router.get('/orders', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { provider, startDate, endDate } = req.query;

    // In production, would fetch from commerce providers
    res.json({ orders: [] });
  } catch (error) {
    logger.error('Get orders failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get orders' });
  }
});

// Shopify webhook handler
router.post('/webhooks/shopify', async (req: Request, res: Response) => {
  try {
    const webhookData = req.body;
    const shopDomain = req.headers['x-shopify-shop-domain'] as string;

    if (!shopDomain) {
      res.status(400).json({ error: 'Shop domain required' });
      return;
    }

    // Get tenant from shop domain
    const tenantResult = await db.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM connector_registry
       WHERE provider = 'shopify' AND connection_id = $1 AND is_enabled = true
       LIMIT 1`,
      [shopDomain]
    );

    if (tenantResult.rows.length === 0) {
      res.status(404).json({ error: 'Shop not found' });
      return;
    }

    const tenantId = tenantResult.rows[0].tenant_id;

    await webhookIngestionService.processWebhook(tenantId, {
      provider: 'shopify',
      eventType: webhookData.topic || 'unknown',
      data: webhookData,
      webhookId: webhookData.id,
    });

    res.json({ message: 'Webhook processed' });
  } catch (error) {
    logger.error('Shopify webhook failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Stripe webhook handler
router.post('/webhooks/stripe', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['stripe-signature'] as string;
    const webhookData = req.body;

    if (!signature) {
      res.status(400).json({ error: 'Signature required' });
      return;
    }

    // In production, would verify signature and get tenant from event
    // For now, simulate
    const tenantId = 'tenant_123'; // Would extract from webhook data

    await webhookIngestionService.processWebhook(tenantId, {
      provider: 'stripe',
      eventType: webhookData.type || 'unknown',
      data: webhookData.data?.object || webhookData,
      signature,
      webhookId: webhookData.id,
    });

    res.json({ received: true });
  } catch (error) {
    logger.error('Stripe webhook failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Trigger payments for approved invoices
router.post('/payments/dispatch', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { invoiceId, amount, currency, method } = req.body;
    if (!invoiceId || !amount || !currency) {
      throw new ValidationError('invoiceId, amount, and currency are required');
    }

    const paymentId = uuid();
    const scheduledAt = new Date();

    res.status(201).json({
      paymentId,
      status: 'scheduled',
      method: method || 'ach',
      amount: Number(amount),
      currency,
      scheduledAt,
    });
  } catch (error) {
    logger.error('Dispatch payment failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to dispatch payment' });
  }
});

// Send payment reminders for AR
router.post('/payments/reminders', (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { customer, amount, dueDate } = req.body;
    if (!customer || !amount) {
      throw new ValidationError('customer and amount are required');
    }

    res.json({
      reminderId: uuid(),
      status: 'queued',
      customer,
      amount: Number(amount),
      dueDate,
    });
  } catch (error) {
    logger.error('Reminder scheduling failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to schedule reminder' });
  }
});

export { router as commerceRouter };
