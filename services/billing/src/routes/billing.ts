import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { db } from '@ai-accountant/database';
import { ValidationError } from '@ai-accountant/shared-utils';
import { upgradeSubscription, cancelTenantSubscription, previewProration } from '../services/subscription';
import { generateInvoice, getInvoices } from '../services/invoiceGenerator';
import { checkUsageLimit, getUsageWithLimits } from '../services/usageEnforcement';
import { getCancellationHistory } from '../services/subscriptionCancellation';
import {
  createOneTimePaymentIntent,
  createBillingPortalSession,
  listPaymentMethods,
  updatePaymentMethod,
  ensureStripeCustomer,
} from '../services/stripe';
import { SUBSCRIPTION_PLANS } from '../services/plans';
import { createCommercePaymentIntent } from '../services/commerce';
import { getCreditBalance } from '../services/credits';

const router = Router();
const logger = createLogger('billing-service');

router.get('/plans', (_req: AuthRequest, res: Response) => {
  res.json({ plans: SUBSCRIPTION_PLANS });
});

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

router.get('/usage/meter', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const meter = await getUsageWithLimits(req.user.tenantId);
    res.json({ meter });
  } catch (error) {
    logger.error('Get usage meter failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to fetch usage meter' });
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

router.post('/subscription/preview', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { tier } = req.body;
    if (!tier) {
      throw new ValidationError('tier is required');
    }

    const preview = await previewProration(req.user.tenantId, tier);
    res.json({ preview });
  } catch (error) {
    logger.error('Preview proration failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to preview proration' });
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

router.post('/payment-intent/commerce', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { amount, currency, metadata } = req.body;
    if (!amount) {
      throw new ValidationError('amount is required');
    }

    const intent = await createCommercePaymentIntent(
      req.user.tenantId,
      parseFloat(amount),
      currency || 'GBP',
      metadata
    );

    res.json({ intent });
  } catch (error) {
    logger.error('Create commerce payment intent failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create commerce payment intent' });
  }
});

// Generate invoice
router.post('/invoices', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

      const { lineItems, issueDate, dueDate } = req.body;

      if (!Array.isArray(lineItems) || lineItems.length === 0) {
        throw new ValidationError('lineItems are required');
      }

      const normalizedLineItems = lineItems.map((item: Record<string, unknown>) => {
        const { description, quantity, unitPrice } = item;
        if (typeof description !== 'string' || !description.trim()) {
          throw new ValidationError('Each line item requires a description');
        }
        if (typeof quantity !== 'number' || Number.isNaN(quantity)) {
          throw new ValidationError('Each line item requires a numeric quantity');
        }
        if (typeof unitPrice !== 'number' || Number.isNaN(unitPrice)) {
          throw new ValidationError('Each line item requires a numeric unitPrice');
        }
        return {
          description: description.trim(),
          quantity,
          unitPrice,
        };
      });

      const invoice = await generateInvoice(
        req.user.tenantId,
        normalizedLineItems,
        issueDate ? new Date(issueDate) : undefined,
        dueDate ? new Date(dueDate) : undefined
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

router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const [invoices, credits] = await Promise.all([
      getInvoices(req.user.tenantId, undefined, 100),
      getCreditBalance(req.user.tenantId),
    ]);

    res.json({ invoices, credits });
  } catch (error) {
    logger.error('Get billing history failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get billing history' });
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

router.get('/payment-methods', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const methods = await listPaymentMethods(req.user.tenantId);
    res.json({ paymentMethods: methods.data });
  } catch (error) {
    logger.error('List payment methods failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to list payment methods' });
  }
});

router.post('/payment-methods/default', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { paymentMethodId } = req.body;
    if (!paymentMethodId) {
      throw new ValidationError('paymentMethodId is required');
    }

    const customerId = await ensureStripeCustomer(req.user.tenantId);
    await updatePaymentMethod(customerId, paymentMethodId);
    res.json({ message: 'Payment method updated' });
  } catch (error) {
    logger.error('Update default payment method failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to update payment method' });
  }
});

export { router as billingRouter };
