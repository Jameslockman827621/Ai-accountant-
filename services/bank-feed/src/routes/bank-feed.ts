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

// Check connection health
router.get('/connections/:connectionId/health', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { connectionId } = req.params;
    const { checkConnectionHealth } = await import('../services/connectionHealth');

    const health = await checkConnectionHealth(req.user.tenantId, connectionId);
    res.json({ health });
  } catch (error) {
    logger.error('Check connection health failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to check connection health' });
  }
});

// Get all connection health
router.get('/connections/health', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { getAllConnectionHealth } = await import('../services/connectionHealth');

    const health = await getAllConnectionHealth(req.user.tenantId);
    res.json({ health });
  } catch (error) {
    logger.error('Get connection health failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get connection health' });
  }
});

// Import CSV transactions
router.post('/import/csv', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { accountId, csvContent } = req.body;

    if (!accountId || !csvContent) {
      throw new ValidationError('accountId and csvContent are required');
    }

    const { importCSVTransactions } = await import('../services/csvImport');

    const imported = await importCSVTransactions(req.user.tenantId, accountId, csvContent);

    res.json({ message: 'CSV imported successfully', imported });
  } catch (error) {
    logger.error('CSV import failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to import CSV' });
  }
});

export { router as bankFeedRouter };
