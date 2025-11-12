import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { connectXero, syncXeroContacts, syncXeroTransactions } from '../services/xero';
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

export { router as integrationsRouter };
