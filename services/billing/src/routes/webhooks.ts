import express, { Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { constructStripeEvent, handleStripeWebhook } from '../services/stripe';
import { verifyBraintreeSignature, handleBraintreeWebhook } from '../services/webhookAdapters';

const logger = createLogger('billing-service');

export async function stripeWebhookHandler(req: express.Request, res: Response): Promise<void> {
  try {
    const signature = req.headers['stripe-signature'];
    const event = constructStripeEvent(req.body as Buffer, signature);

    const eventId = event.id;
    const tenantId = (event.data.object as any).metadata?.tenantId as string | undefined;

    const existingResult = await db.query<{ id: string }>(
      `SELECT id FROM webhook_events
       WHERE id = $1 AND provider = 'stripe'`,
      [eventId]
    );

    if (existingResult.rows.length > 0) {
      logger.info('Duplicate webhook event ignored', { eventId, type: event.type });
      res.json({ received: true, duplicate: true });
      return;
    }

    await db.query(
      `INSERT INTO webhook_events (id, tenant_id, provider, event_type, payload, created_at)
       VALUES ($1, $2, 'stripe', $3, $4::jsonb, NOW())`,
      [eventId, tenantId || 'unknown', event.type, JSON.stringify(event)]
    );

    await handleStripeWebhook(event);

    res.json({ received: true });
  } catch (error) {
    logger.error('Stripe webhook failed', error instanceof Error ? error : new Error(String(error)));
    res.status(400).json({ error: 'Webhook error' });
  }
}

export async function braintreeWebhookHandler(req: express.Request, res: Response): Promise<void> {
  try {
    const params = new URLSearchParams(req.body as string);
    const payload = params.get('bt_payload');
    const signature = params.get('bt_signature');

    if (!payload || !signature) {
      res.status(400).json({ error: 'Missing Braintree payload or signature' });
      return;
    }

    const verified = verifyBraintreeSignature(payload, signature);
    if (!verified.valid) {
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    const eventId = verified.event.id;
    const tenantId = verified.event.tenantId || 'unknown';

    const existingResult = await db.query<{ id: string }>(
      `SELECT id FROM webhook_events
       WHERE id = $1 AND provider = 'braintree'`,
      [eventId]
    );

    if (existingResult.rows.length > 0) {
      res.json({ received: true, duplicate: true });
      return;
    }

    await db.query(
      `INSERT INTO webhook_events (id, tenant_id, provider, event_type, payload, created_at)
       VALUES ($1, $2, 'braintree', $3, $4::jsonb, NOW())`,
      [eventId, tenantId, verified.event.type, JSON.stringify(verified.event)]
    );

    await handleBraintreeWebhook(verified.event);
    res.json({ received: true });
  } catch (error) {
    logger.error('Braintree webhook failed', error instanceof Error ? error : new Error(String(error)));
    res.status(400).json({ error: 'Webhook error' });
  }
}
