import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { AuthRequest } from '../middleware/auth';
import {
  createLinkToken,
  exchangePublicToken,
  syncPlaidTransactions,
} from '../services/plaid';
import {
  createTrueLayerAuthLink,
  exchangeTrueLayerCode,
  fetchTrueLayerTransactions,
} from '../services/truelayer';
import { getAllConnectionHealth, checkConnectionHealth } from '../services/connectionHealth';

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

      const { publicToken, institution, accounts } = req.body;

    if (!publicToken) {
      throw new ValidationError('Public token is required');
    }

      const metadata =
        institution || accounts
          ? {
              institution: institution || null,
              accounts: accounts || null,
            }
          : undefined;

      const result = await exchangePublicToken(publicToken, req.user.tenantId, metadata);

    res.json({ connectionId: result.connectionId, itemId: result.itemId });
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

    const { connectionId, startDate, endDate } = req.body;

    if (!connectionId || !startDate || !endDate) {
      throw new ValidationError('connectionId, startDate, and endDate are required');
    }

    await syncPlaidTransactions(
      req.user.tenantId,
      connectionId,
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

// List connections
router.get('/connections', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const [connectionsResult, health] = await Promise.all([
      db.query<{
        id: string;
        provider: string;
        metadata: Record<string, unknown> | null;
        last_sync: Date | null;
        last_success: Date | null;
        token_expires_at: Date | null;
        last_refreshed_at: Date | null;
        created_at: Date;
        updated_at: Date;
        is_active: boolean;
        exception_count: number;
        error_count: number;
        item_id: string | null;
        provider_account_id: string | null;
      }>(
        `SELECT id, provider, metadata, last_sync, last_success, token_expires_at,
                last_refreshed_at, created_at, updated_at, is_active,
                exception_count, error_count, item_id, provider_account_id
         FROM bank_connections
         WHERE tenant_id = $1
         ORDER BY created_at DESC`,
        [req.user.tenantId]
      ),
      getAllConnectionHealth(req.user.tenantId).catch(() => []),
    ]);

    const healthMap = new Map(health.map(item => [item.connectionId, item]));

    res.json({
      connections: connectionsResult.rows.map(row => {
        const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
        const healthInfo = healthMap.get(row.id);
        return {
          id: row.id,
          provider: row.provider,
          metadata,
          status: healthInfo?.status ?? 'unknown',
          lastSync: row.last_sync,
          lastSuccess: row.last_success,
          nextSync: healthInfo?.nextSync ?? null,
          lastRefreshedAt: row.last_refreshed_at,
          tokenExpiresAt: row.token_expires_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          isActive: row.is_active,
          exceptionCount: row.exception_count,
          errorCount: row.error_count,
          itemId: row.item_id,
          providerAccountId: row.provider_account_id,
        };
      }),
    });
  } catch (error) {
    logger.error('List connections failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to list connections' });
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

    const state = randomUUID();
    const authUrl = await createTrueLayerAuthLink(
      req.user.userId,
      redirectUri,
      state
    );
    res.json({ authUrl, state });
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

    const { connectionId, accountId, startDate, endDate } = req.body;
    if (!connectionId || !accountId || !startDate || !endDate) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    await fetchTrueLayerTransactions(
      connectionId,
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
    const health = await checkConnectionHealth(req.user.tenantId, connectionId);
    res.json({ health });
  } catch (error) {
    logger.error('Check connection health failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to check connection health' });
  }
});

// Manual sync endpoint
router.post('/connections/:connectionId/sync', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { connectionId } = req.params;
    const { accountId, startDate, endDate } = req.body as {
      accountId?: string;
      startDate?: string;
      endDate?: string;
    };

    const connectionResult = await db.query<{
      id: string;
      provider: 'plaid' | 'truelayer';
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT id, provider, metadata
       FROM bank_connections
       WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
      [connectionId, req.user.tenantId]
    );

    if (connectionResult.rows.length === 0) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    const connection = connectionResult.rows[0];
    const syncEnd = endDate ? new Date(endDate) : new Date();
    const syncStart = startDate ? new Date(startDate) : new Date(syncEnd);
    if (!startDate) {
      syncStart.setMonth(syncStart.getMonth() - 3);
    }

    let count = 0;
    if (connection.provider === 'plaid') {
      count = await syncPlaidTransactions(req.user.tenantId, connectionId, syncStart, syncEnd);
    } else {
      const accounts = (connection.metadata?.accounts as Array<{ account_id: string }> | undefined) || [];
      const resolvedAccount = accountId || accounts[0]?.account_id;
      if (!resolvedAccount) {
        throw new ValidationError('accountId is required for TrueLayer connections');
      }
      count = await fetchTrueLayerTransactions(connectionId, req.user.tenantId, resolvedAccount, syncStart, syncEnd);
    }

    res.json({ message: `Synced ${count} transactions`, count });
  } catch (error) {
    logger.error('Manual sync failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to sync connection' });
  }
});

// Disconnect connection
router.delete('/connections/:connectionId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { connectionId } = req.params;
    const result = await db.query(
      `UPDATE bank_connections
       SET is_active = false,
           updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [connectionId, req.user.tenantId]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    res.json({ message: 'Connection disconnected' });
  } catch (error) {
    logger.error('Disconnect connection failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to disconnect connection' });
  }
});

// Get all connection health
router.get('/connections/health', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

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
