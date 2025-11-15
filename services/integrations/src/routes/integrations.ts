import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { connectXero, syncXeroContacts, syncXeroTransactions } from '../services/xero';
import { connectStripe, syncStripeTransactions, handleStripeWebhook } from '../services/stripe';
import { connectQuickBooks, syncQuickBooksAccounts, syncQuickBooksTransactions } from '../services/quickbooks';
import {
  connectHMRC,
  disconnectHMRC,
  getHMRCObligations,
  getHMRCStatus,
  refreshHMRCToken,
} from '../services/hmrc';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('integrations-service');

// Xero integration
router.post('/xero/connect', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { accessToken, refreshToken, tenantIdXero } = req.body;

    if (!accessToken || !refreshToken || !tenantIdXero) {
      throw new ValidationError('accessToken, refreshToken, and tenantIdXero are required');
    }

    await connectXero(req.user.tenantId, accessToken, refreshToken, tenantIdXero);
    res.json({ message: 'Xero connected successfully' });
  } catch (error) {
    logger.error('Connect Xero failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to connect Xero' });
  }
});

router.post('/xero/sync/contacts', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await syncXeroContacts(req.user.tenantId);
    res.json({ message: 'Xero contacts synced successfully' });
  } catch (error) {
    logger.error('Sync Xero contacts failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to sync Xero contacts' });
  }
});

router.post('/xero/sync/transactions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      throw new ValidationError('startDate and endDate are required');
    }

    const count = await syncXeroTransactions(
      req.user.tenantId,
      new Date(startDate),
      new Date(endDate)
    );

    res.json({ message: 'Xero transactions synced successfully', count });
  } catch (error) {
    logger.error('Sync Xero transactions failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to sync Xero transactions' });
  }
});

// Stripe integration
router.post('/stripe/connect', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { apiKey, webhookSecret } = req.body;

    if (!apiKey) {
      throw new ValidationError('apiKey is required');
    }

    await connectStripe(req.user.tenantId, apiKey, webhookSecret);
    res.json({ message: 'Stripe connected successfully' });
  } catch (error) {
    logger.error('Connect Stripe failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to connect Stripe' });
  }
});

router.post('/stripe/sync/transactions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      throw new ValidationError('startDate and endDate are required');
    }

    const count = await syncStripeTransactions(
      req.user.tenantId,
      new Date(startDate),
      new Date(endDate)
    );

    res.json({ message: 'Stripe transactions synced successfully', count });
  } catch (error) {
    logger.error('Sync Stripe transactions failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to sync Stripe transactions' });
  }
});

router.post('/stripe/webhook', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { event, data } = req.body;

    if (!event || !data) {
      throw new ValidationError('event and data are required');
    }

    await handleStripeWebhook(req.user.tenantId, event, data);
    res.json({ message: 'Webhook processed successfully' });
  } catch (error) {
    logger.error('Handle Stripe webhook failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// QuickBooks integration
router.post('/quickbooks/connect', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { accessToken, refreshToken, realmId } = req.body;

    if (!accessToken || !refreshToken || !realmId) {
      throw new ValidationError('accessToken, refreshToken, and realmId are required');
    }

    await connectQuickBooks(req.user.tenantId, accessToken, refreshToken, realmId);
    res.json({ message: 'QuickBooks connected successfully' });
  } catch (error) {
    logger.error('Connect QuickBooks failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to connect QuickBooks' });
  }
});

router.post('/quickbooks/sync/accounts', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await syncQuickBooksAccounts(req.user.tenantId);
    res.json({ message: 'QuickBooks accounts synced successfully' });
  } catch (error) {
    logger.error('Sync QuickBooks accounts failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to sync QuickBooks accounts' });
  }
});

router.post('/quickbooks/sync/transactions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.body;

    if (!startDate || !endDate) {
      throw new ValidationError('startDate and endDate are required');
    }

    const count = await syncQuickBooksTransactions(
      req.user.tenantId,
      new Date(startDate),
      new Date(endDate)
    );

    res.json({ message: 'QuickBooks transactions synced successfully', count });
  } catch (error) {
    logger.error('Sync QuickBooks transactions failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to sync QuickBooks transactions' });
  }
});

router.post('/hmrc/connect', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { authorizationCode, redirectUri, vrn } = req.body;

    if (!authorizationCode || !redirectUri) {
      throw new ValidationError('authorizationCode and redirectUri are required');
    }

    await connectHMRC(req.user.tenantId, authorizationCode, redirectUri, vrn);
    res.json({ message: 'HMRC connected successfully' });
  } catch (error) {
    logger.error('Connect HMRC failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to connect HMRC' });
  }
});

router.get('/hmrc/status', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const status = await getHMRCStatus(req.user.tenantId);
    res.json({ status });
  } catch (error) {
    logger.error('Get HMRC status failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get HMRC status' });
  }
});

router.post('/hmrc/refresh', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await refreshHMRCToken(req.user.tenantId);
    res.json({ message: 'HMRC token refreshed' });
  } catch (error) {
    logger.error('Refresh HMRC token failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to refresh HMRC token' });
  }
});

router.delete('/hmrc/disconnect', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await disconnectHMRC(req.user.tenantId);
    res.json({ message: 'HMRC disconnected' });
  } catch (error) {
    logger.error('Disconnect HMRC failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to disconnect HMRC' });
  }
});

router.get('/hmrc/obligations', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, from, to } = req.query;

    const obligations = await getHMRCObligations(req.user.tenantId, {
      status: typeof status === 'string' ? status : undefined,
      from: typeof from === 'string' ? from : undefined,
      to: typeof to === 'string' ? to : undefined,
    });

    res.json({ obligations });
  } catch (error) {
    logger.error('Get HMRC obligations failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get HMRC obligations' });
  }
});

export { router as integrationsRouter };
