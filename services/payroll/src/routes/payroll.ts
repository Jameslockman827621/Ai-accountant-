import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { ValidationError } from '@ai-accountant/shared-utils';
import { createGustoService } from '../services/gusto';
import { createQuickBooksPayrollService } from '../services/quickbooksPayroll';
import { createADPService } from '../services/adp';
import { db } from '@ai-accountant/database';
import { unifiedIngestionService } from '../../ingestion/src/services/unifiedIngestion';

const router = Router();
const logger = createLogger('payroll-service');

// Get payroll connectors
router.get('/connectors', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.query(
      `SELECT cr.*, cs.last_sync_at, cs.last_sync_status, cs.next_sync_at
       FROM connector_registry cr
       LEFT JOIN connector_sync_schedule cs ON cs.connector_id = cr.id
       WHERE cr.tenant_id = $1 AND cr.connector_type = 'payroll'
       ORDER BY cr.created_at DESC`,
      [req.user.tenantId]
    );

    res.json({ connectors: result.rows });
  } catch (error) {
    logger.error('Get payroll connectors failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get payroll connectors' });
  }
});

// Connect Gusto
router.post('/gusto/connect', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { code, state } = req.body;

    if (!code) {
      throw new ValidationError('Authorization code is required');
    }

    const gustoService = createGustoService({
      clientId: process.env.GUSTO_CLIENT_ID || '',
      clientSecret: process.env.GUSTO_CLIENT_SECRET || '',
      redirectUri: process.env.GUSTO_REDIRECT_URI || '',
      environment: (process.env.GUSTO_ENV as 'sandbox' | 'production') || 'sandbox',
    });

    const tokens = await gustoService.exchangeCodeForToken(code);

    // Store connector
    const connectorId = await db.query(
      `INSERT INTO connector_registry (
        tenant_id, connector_type, provider, connector_name,
        is_enabled, status, credential_store_key, connected_at, connected_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
      RETURNING id`,
      [
        req.user.tenantId,
        'payroll',
        'gusto',
        'Gusto Payroll',
        true,
        'enabled',
        `gusto_${req.user.tenantId}_${Date.now()}`, // In production, store encrypted
        req.user.userId,
      ]
    );

    // Create sync schedule
    await db.query(
      `INSERT INTO connector_sync_schedule (
        connector_id, tenant_id, sync_frequency, is_active, next_sync_at
      ) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour')`,
      [connectorId.rows[0].id, req.user.tenantId, 'daily', true]
    );

    res.json({ connectorId: connectorId.rows[0].id, message: 'Gusto connected successfully' });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Gusto connection failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to connect Gusto' });
  }
});

// Get Gusto authorization URL
router.get('/gusto/authorize', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const gustoService = createGustoService({
      clientId: process.env.GUSTO_CLIENT_ID || '',
      clientSecret: process.env.GUSTO_CLIENT_SECRET || '',
      redirectUri: process.env.GUSTO_REDIRECT_URI || '',
      environment: (process.env.GUSTO_ENV as 'sandbox' | 'production') || 'sandbox',
    });

    const state = `gusto_${req.user.tenantId}_${Date.now()}`;
    const authUrl = gustoService.generateAuthorizationUrl(state);

    res.json({ authorizationUrl: authUrl, state });
  } catch (error) {
    logger.error('Get Gusto auth URL failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get authorization URL' });
  }
});

// Sync payroll data
router.post('/sync/:connectorId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { connectorId } = req.params;
    const { startDate, endDate } = req.body;

    const connector = await db.query(
      'SELECT provider, connection_id, credential_store_key FROM connector_registry WHERE id = $1 AND tenant_id = $2',
      [connectorId, req.user.tenantId]
    );

    if (connector.rows.length === 0) {
      throw new ValidationError('Connector not found');
    }

    const conn = connector.rows[0];

    // In production, would fetch actual payroll data
    // For now, simulate sync
    const ingestionLogId = await unifiedIngestionService.logIngestion(
      req.user.tenantId,
      req.user.userId,
      {
        sourceType: 'payroll',
        connectorId,
        connectorProvider: conn.provider,
        payload: {
          syncDate: new Date().toISOString(),
          startDate,
          endDate,
        },
      }
    );

    res.json({ ingestionLogId, message: 'Payroll sync initiated' });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Payroll sync failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to sync payroll' });
  }
});

// Get payroll runs
router.get('/runs', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.query;

    // In production, would fetch from payroll providers
    res.json({ runs: [] });
  } catch (error) {
    logger.error('Get payroll runs failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get payroll runs' });
  }
});

export { router as payrollRouter };
