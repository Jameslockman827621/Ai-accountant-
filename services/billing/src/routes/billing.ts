import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { db } from '@ai-accountant/database';
import { ValidationError } from '@ai-accountant/shared-utils';
import { upgradeSubscription, cancelTenantSubscription } from '../services/subscription';
import {
  generateInvoice,
  getInvoices,
  markInvoicePaid,
} from '../services/invoiceGenerator';
import {
  checkUsageLimit,
  recordUsage,
} from '../services/usageEnforcement';
import {
  handlePaymentFailure,
  resolvePaymentFailure,
} from '../services/paymentFailureHandler';
import {
  cancelTenantSubscription as cancelSubscription,
  getCancellationHistory,
} from '../services/subscriptionCancellation';
import {
  createOneTimePaymentIntent,
  createBillingPortalSession,
  constructStripeEvent,
  handleStripeWebhook,
} from '../services/stripe';

const router = Router();
const logger = createLogger('billing-service');

// Get subscription
router.get('/subscription', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.query(
      `SELECT s.*, t.subscription_tier
       FROM subscriptions s
       JOIN tenants t ON s.tenant_id = t.id
       WHERE s.tenant_id = $1`,
      [req.user.tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    res.json({ subscription: result.rows[0] });
  } catch (error) {
    logger.error('Get subscription failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get subscription' });
  }
});

// Get usage metrics
router.get('/usage', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { period } = req.query;
    const currentPeriod = period as string || new Date().toISOString().slice(0, 7); // YYYY-MM

    const result = await db.query(
      `SELECT * FROM usage_metrics
       WHERE tenant_id = $1 AND period = $2`,
      [req.user.tenantId, currentPeriod]
    );

    if (result.rows.length === 0) {
      // Return zero usage if no metrics found
      res.json({
        usage: {
          tenantId: req.user.tenantId,
          period: currentPeriod,
          documentsProcessed: 0,
          ocrRequests: 0,
          llmQueries: 0,
          filingsSubmitted: 0,
          storageUsed: 0,
        },
      });
      return;
    }

    res.json({ usage: result.rows[0] });
  } catch (error) {
    logger.error('Get usage failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get usage' });
  }
});

// Update subscription (upgrade/downgrade)
router.put('/subscription', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { tier } = req.body;

    if (!tier) {
      throw new ValidationError('tier is required');
    }

    await upgradeSubscription(req.user.tenantId, tier);

    res.json({ message: 'Subscription updated' });
  } catch (error) {
    logger.error('Update subscription failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

// Cancel subscription
router.post('/subscription/cancel', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { cancelAtPeriodEnd } = req.body;

    await cancelTenantSubscription(req.user.tenantId, cancelAtPeriodEnd !== false);

    res.json({ message: 'Subscription cancellation scheduled' });
  } catch (error) {
    logger.error('Cancel subscription failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Create payment intent (for one-time payments)
router.post('/payment-intent', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { amount, currency, metadata } = req.body;

    if (!amount) {
      throw new ValidationError('amount is required');
    }

    const paymentIntent = await createOneTimePaymentIntent(
      req.user.tenantId,
      parseFloat(amount),
      currency || 'gbp',
      metadata
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency.toUpperCase(),
    });
  } catch (error) {
    logger.error('Create payment intent failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// Generate invoice
router.post('/invoices', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { periodStart, periodEnd } = req.body;

    if (!periodStart || !periodEnd) {
      throw new ValidationError('periodStart and periodEnd are required');
    }

    const { generateInvoice } = await import('../services/invoiceGenerator');

    const invoice = await generateInvoice(
      req.user.tenantId,
      new Date(periodStart),
      new Date(periodEnd)
    );

    res.status(201).json({ invoice });
  } catch (error) {
    logger.error('Generate invoice failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate invoice' });
  }
});

// Get invoices
router.get('/invoices', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status } = req.query;
    const invoices = await getInvoices(
      req.user.tenantId,
      status as any,
      50
    );

    res.json({ invoices });
  } catch (error) {
    logger.error('Get invoices failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get invoices' });
  }
});

// Check usage limit
router.get('/usage/check', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { resourceType } = req.query;

    if (!resourceType) {
      throw new ValidationError('resourceType is required');
    }

    const check = await checkUsageLimit(
      req.user.tenantId,
      resourceType as any
    );

    res.json({ check });
  } catch (error) {
    logger.error('Check usage limit failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to check usage limit' });
  }
});

// Get cancellation history
router.get('/subscription/cancellation-history', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const history = await getCancellationHistory(req.user.tenantId);
    res.json({ history });
  } catch (error) {
    logger.error('Get cancellation history failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get cancellation history' });
  }
});

// Create billing portal session
router.post('/billing-portal', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { returnUrl } = req.body;
    if (!returnUrl) {
      throw new ValidationError('returnUrl is required');
    }

    const session = await createBillingPortalSession(req.user.tenantId, returnUrl);
    res.json({ url: session.url });
  } catch (error) {
    logger.error('Create billing portal session failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create billing portal session' });
  }
});

// Stripe webhook endpoint (no auth required - uses signature verification)
router.post('/webhook/stripe', async (req, res: Response) => {
  try {
    const signature = req.headers['stripe-signature'];
    const event = constructStripeEvent(req.body, signature);
    
    // Idempotency check - prevent duplicate processing
    const eventId = event.id;
    const tenantId = (event.data.object as any).metadata?.tenantId as string | undefined;
    
    const existingResult = await db.query<{
      id: string;
    }>(
      `SELECT id FROM webhook_events
       WHERE id = $1 AND provider = 'stripe'`,
      [eventId]
    );

    if (existingResult.rows.length > 0) {
      logger.info('Duplicate webhook event ignored', { eventId, type: event.type });
      res.json({ received: true, duplicate: true });
      return;
    }

    // Store event for idempotency
    await db.query(
      `INSERT INTO webhook_events (id, tenant_id, provider, event_type, payload, created_at)
       VALUES ($1, $2, 'stripe', $3, $4::jsonb, NOW())`,
      [eventId, tenantId || 'unknown', event.type, JSON.stringify(event)]
    );

    // Process webhook
    await handleStripeWebhook(event);
    
    res.json({ received: true });
  } catch (error) {
    logger.error('Stripe webhook failed', error instanceof Error ? error : new Error(String(error)));
    res.status(400).json({ error: 'Webhook error' });
  }
});

export { router as billingRouter };
