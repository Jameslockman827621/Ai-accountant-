import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { createLinkToken, exchangePublicToken, fetchTransactions } from '../services/plaid';
import { createTrueLayerAuthLink, exchangeTrueLayerCode, fetchTrueLayerTransactions } from '../services/truelayer';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('bank-feed-service');

// Create Plaid link token
router.post('/plaid/link-token', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const linkToken = await createLinkToken(req.user.userId);

    res.json({ linkToken });
  } catch (error) {
    logger.error('Create link token failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to create link token' });
  }
});

// Exchange public token for access token
router.post('/plaid/exchange-token', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { publicToken } = req.body;

    if (!publicToken) {
      throw new ValidationError('Public token is required');
    }

    const result = await exchangePublicToken(publicToken, req.user.tenantId);

    res.json({ accessToken: result.accessToken, itemId: result.itemId });
  } catch (error) {
    logger.error('Exchange token failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

// Fetch transactions
router.post('/plaid/fetch-transactions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { accessToken, startDate, endDate } = req.body;

    if (!accessToken || !startDate || !endDate) {
      throw new ValidationError('Access token, start date, and end date are required');
    }

    await fetchTransactions(
      accessToken,
      req.user.tenantId,
      new Date(startDate),
      new Date(endDate)
    );

    res.json({ message: 'Transactions fetched successfully' });
  } catch (error) {
    logger.error('Fetch transactions failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// TrueLayer routes
router.post('/truelayer/auth-link', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { redirectUri } = req.body;
    if (!redirectUri) {
      res.status(400).json({ error: 'Redirect URI is required' });
      return;
    }

    const authUrl = await createTrueLayerAuthLink(req.user.userId, redirectUri);
    res.json({ authUrl });
  } catch (error) {
    logger.error('Create TrueLayer auth link failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to create auth link' });
  }
});

router.post('/truelayer/exchange', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { code, redirectUri } = req.body;
    if (!code || !redirectUri) {
      res.status(400).json({ error: 'Code and redirect URI are required' });
      return;
    }

    const result = await exchangeTrueLayerCode(code, redirectUri, req.user.tenantId);
    res.json(result);
  } catch (error) {
    logger.error('Exchange TrueLayer code failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to exchange code' });
  }
});

router.post('/truelayer/fetch', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { accessToken, accountId, startDate, endDate } = req.body;
    if (!accessToken || !accountId || !startDate || !endDate) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    await fetchTrueLayerTransactions(
      accessToken,
      req.user.tenantId,
      accountId,
      new Date(startDate),
      new Date(endDate)
    );

    res.json({ message: 'Transactions fetched successfully' });
  } catch (error) {
    logger.error('Fetch TrueLayer transactions failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export { router as bankFeedRouter };
