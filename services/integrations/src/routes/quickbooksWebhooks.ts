/**
 * QuickBooks Webhook Handler
 */

import { Router } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import crypto from 'crypto';

const logger = createLogger('quickbooks-webhooks');
const router = Router();

// Verify webhook signature
function verifyWebhookSignature(
  payload: string,
  signature: string,
  verifierToken: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', verifierToken)
    .update(payload)
    .digest('base64');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Handle QuickBooks webhook events
router.post('/quickbooks/webhook', async (req, res) => {
  try {
    const signature = req.headers['intuit-signature'] as string;
    const verifierToken = process.env.QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN || '';

    if (!signature) {
      return res.status(401).json({ error: 'Missing signature' });
    }

    const payload = JSON.stringify(req.body);
    
    if (!verifyWebhookSignature(payload, signature, verifierToken)) {
      logger.warn('Invalid QuickBooks webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    const eventType = event.eventNotifications?.[0]?.eventNotifications?.[0]?.eventType;
    const realmId = event.eventNotifications?.[0]?.realmId;

    logger.info('QuickBooks webhook received', { eventType, realmId });

    // Get tenant ID from realm ID
    const connection = await db.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM quickbooks_connections WHERE realm_id = $1',
      [realmId]
    );

    if (connection.rows.length === 0) {
      logger.warn('No connection found for realm', { realmId });
      return res.status(404).json({ error: 'Connection not found' });
    }

    const tenantId = connection.rows[0].tenant_id;

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

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('QuickBooks webhook error', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
