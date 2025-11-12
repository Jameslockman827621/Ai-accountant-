import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { db } from '@ai-accountant/database';

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

export { router as billingRouter };
