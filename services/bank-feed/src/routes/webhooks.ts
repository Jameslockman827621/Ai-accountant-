import { Router, Response, Request } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { handlePlaidWebhook } from '../services/plaid';
import { handleTrueLayerWebhook } from '../services/truelayer';

const router = Router();
const logger = createLogger('bank-feed-webhooks');

function validateSecret(req: Request, secretEnvName: string): boolean {
  const expected = process.env[secretEnvName];
  if (!expected) {
    return true;
  }
  const provided =
    (req.headers['x-webhook-secret'] as string | undefined) ||
    (req.query.secret as string | undefined);
  return provided === expected;
}

router.post('/plaid', async (req: Request, res: Response) => {
  try {
    if (!validateSecret(req, 'PLAID_WEBHOOK_SECRET')) {
      res.status(401).json({ error: 'Invalid webhook secret' });
      return;
    }

    await handlePlaidWebhook(req.body);
    res.json({ status: 'ok' });
  } catch (error) {
    logger.error('Plaid webhook processing failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

router.post('/truelayer', async (req: Request, res: Response) => {
  try {
    if (!validateSecret(req, 'TRUELAYER_WEBHOOK_SECRET')) {
      res.status(401).json({ error: 'Invalid webhook secret' });
      return;
    }

    await handleTrueLayerWebhook(req.body);
    res.json({ status: 'ok' });
  } catch (error) {
    logger.error('TrueLayer webhook processing failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

export { router as bankFeedWebhookRouter };
