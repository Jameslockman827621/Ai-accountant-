/**
 * QuickBooks Webhook Handler
 */

import { Router, type Request, type Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import crypto from 'crypto';

const logger = createLogger('quickbooks-webhooks');
const router = Router();

interface QuickBooksWebhookEntity {
  name?: string;
  operation?: string;
  id?: string;
  eventType?: string;
}

interface QuickBooksWebhookNotification {
  realmId?: string;
  dataChangeEvent?: {
    entities?: QuickBooksWebhookEntity[];
  };
}

interface QuickBooksWebhookPayload {
  eventNotifications?: QuickBooksWebhookNotification[];
}

// Verify webhook signature
function verifyWebhookSignature(
  payload: string,
  signature: string | undefined,
  verifierToken: string
): boolean {
  if (!signature || !verifierToken) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', verifierToken)
    .update(payload)
    .digest('base64');

  const providedBuffer = Buffer.from(signature, 'base64');
  const expectedBuffer = Buffer.from(expectedSignature, 'base64');

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

// Handle QuickBooks webhook events
router.post('/quickbooks/webhook', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['intuit-signature'] as string | undefined;
    const verifierToken = process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN || '';

    if (!signature) {
      return res.status(401).json({ error: 'Missing signature' });
    }

    const payload = JSON.stringify(req.body);
    
    if (!verifyWebhookSignature(payload, signature, verifierToken)) {
      logger.warn('Invalid QuickBooks webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body as QuickBooksWebhookPayload;
    const notifications = event.eventNotifications ?? [];
    const primaryNotification = notifications[0];
    const realmId = primaryNotification?.realmId;
    const entity = primaryNotification?.dataChangeEvent?.entities?.[0];
    const eventType = entity?.eventType || entity?.name || 'unknown';

    logger.info('QuickBooks webhook received', { eventType, realmId, notificationCount: notifications.length });

    if (!realmId) {
      logger.warn('QuickBooks webhook missing realm ID');
      return res.status(400).json({ error: 'Missing realm ID' });
    }

    // Get tenant ID from realm ID
    const connection = await db.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM quickbooks_connections WHERE realm_id = $1',
      [realmId]
    );

    const connectionRow = connection.rows[0];

    if (!connectionRow) {
      logger.warn('No connection found for realm', { realmId });
      return res.status(404).json({ error: 'Connection not found' });
    }

    const tenantId = connectionRow.tenant_id;

    // Handle different event types
    switch (eventType) {
      case 'Invoice':
      case 'Payment':
      case 'JournalEntry':
        // Trigger sync for affected entity
        logger.info('Triggering sync for QuickBooks event', { eventType, tenantId });
        // In production, queue a sync job
        break;
      
      case 'Account':
        // Account was updated
        logger.info('Account updated in QuickBooks', { tenantId });
        // Trigger account sync
        break;
      
      default:
        logger.info('Unhandled QuickBooks event type', { eventType, tenantId });
    }

    // Store webhook event for audit
    await db.query(
      `INSERT INTO webhook_events (
        id, tenant_id, provider, event_type, payload, created_at
      ) VALUES (gen_random_uuid(), $1, 'quickbooks', $2, $3, NOW())`,
      [tenantId, eventType, JSON.stringify(event)]
    );

    return res.status(200).json({ received: true });
  } catch (error) {
    logger.error('QuickBooks webhook error', { error });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
