/**
 * Xero Webhook Handler
 */

import { Router, type Request, type Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import crypto from 'crypto';

const logger = createLogger('xero-webhooks');
const router = Router();

interface XeroWebhookEvent {
  eventType?: string;
  resourceId?: string;
  resourceType?: string;
}

interface XeroWebhookPayload {
  events?: XeroWebhookEvent[];
  tenantId?: string;
}

// Verify webhook signature
function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
  webhookKey: string
): boolean {
  if (!signature || !webhookKey) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', webhookKey)
    .update(payload)
    .digest('base64');
  
  const providedBuffer = Buffer.from(signature, 'base64');
  const expectedBuffer = Buffer.from(expectedSignature, 'base64');

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

// Handle Xero webhook events
router.post('/xero/webhook', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-xero-signature'] as string | undefined;
    const webhookKey = process.env.XERO_WEBHOOK_KEY || '';

    if (!signature) {
      return res.status(401).json({ error: 'Missing signature' });
    }

    const payload = JSON.stringify(req.body);
    
    if (!verifyWebhookSignature(payload, signature, webhookKey)) {
      logger.warn('Invalid Xero webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body as XeroWebhookPayload;
    const events = event.events ?? [];
    const tenantIdXero = event.tenantId;

    logger.info('Xero webhook received', { eventCount: events.length, tenantIdXero });

    if (!tenantIdXero) {
      logger.warn('Missing tenant ID in Xero webhook');
      return res.status(400).json({ error: 'Missing tenant ID' });
    }

    // Get tenant ID from Xero tenant ID
    const connection = await db.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM xero_connections WHERE tenant_id_xero = $1',
      [tenantIdXero]
    );

    const connectionRow = connection.rows[0];

    if (!connectionRow) {
      logger.warn('No connection found for Xero tenant', { tenantIdXero });
      return res.status(404).json({ error: 'Connection not found' });
    }

    const tenantId = connectionRow.tenant_id;

    // Handle different event types
    for (const evt of events) {
      const eventType = evt.eventType || 'unknown';
      const resourceId = evt.resourceId;
      const resourceType = evt.resourceType || 'unknown';

      logger.info('Processing Xero event', { eventType, resourceType, resourceId, tenantId });

      switch (resourceType) {
        case 'Invoice':
        case 'Payment':
        case 'BankTransaction':
          // Trigger sync for affected entity
          logger.info('Triggering sync for Xero event', { eventType, resourceType, tenantId });
          // In production, queue a sync job
          break;
        
        case 'Contact':
          // Contact was updated
          logger.info('Contact updated in Xero', { tenantId, resourceId });
          // Trigger contact sync
          break;
        
        case 'Account':
          // Account was updated
          logger.info('Account updated in Xero', { tenantId, resourceId });
          // Trigger account sync
          break;
        
        default:
          logger.info('Unhandled Xero event type', { eventType, resourceType, tenantId });
      }
    }

    // Store webhook event for audit
    const primaryEventType = events[0]?.eventType || 'unknown';

    await db.query(
      `INSERT INTO webhook_events (
        id, tenant_id, provider, event_type, payload, created_at
      ) VALUES (gen_random_uuid(), $1, 'xero', $2, $3, NOW())`,
      [tenantId, primaryEventType, JSON.stringify(event)]
    );

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Xero webhook error', { error });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
