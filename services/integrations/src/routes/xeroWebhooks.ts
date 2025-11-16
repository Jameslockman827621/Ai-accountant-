/**
 * Xero Webhook Handler
 */

import { Router } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import crypto from 'crypto';

const logger = createLogger('xero-webhooks');
const router = Router();

// Verify webhook signature
function verifyWebhookSignature(
  payload: string,
  signature: string,
  webhookKey: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', webhookKey)
    .update(payload)
    .digest('base64');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Handle Xero webhook events
router.post('/xero/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-xero-signature'] as string;
    const webhookKey = process.env.XERO_WEBHOOK_KEY || '';

    if (!signature) {
      return res.status(401).json({ error: 'Missing signature' });
    }

    const payload = JSON.stringify(req.body);
    
    if (!verifyWebhookSignature(payload, signature, webhookKey)) {
      logger.warn('Invalid Xero webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    const events = event.events || [];
    const tenantIdXero = event.tenantId;

    logger.info('Xero webhook received', { eventCount: events.length, tenantIdXero });

    // Get tenant ID from Xero tenant ID
    const connection = await db.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM xero_connections WHERE tenant_id_xero = $1',
      [tenantIdXero]
    );

    if (connection.rows.length === 0) {
      logger.warn('No connection found for Xero tenant', { tenantIdXero });
      return res.status(404).json({ error: 'Connection not found' });
    }

    const tenantId = connection.rows[0].tenant_id;

    // Handle different event types
    for (const evt of events) {
      const eventType = evt.eventType;
      const resourceId = evt.resourceId;
      const resourceType = evt.resourceType;

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
    await db.query(
      `INSERT INTO webhook_events (
        id, tenant_id, provider, event_type, payload, created_at
      ) VALUES (gen_random_uuid(), $1, 'xero', $2, $3, NOW())`,
      [tenantId, JSON.stringify(events), JSON.stringify(event)]
    );

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('Xero webhook error', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
