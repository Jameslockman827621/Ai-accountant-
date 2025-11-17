import { Router, Request, Response } from 'express';
import { periodCloseService } from '../services/periodCloseService';
import { TenantId, UserId } from '@ai-accountant/shared-types';

interface AuthRequest extends Request {
  user?: {
    tenantId: TenantId;
    userId: UserId;
  };
}

const router = Router();

/**
 * POST /api/ledger/period-close
 * Create or get period close
 */
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { periodStart, periodEnd, entityId } = req.body;

    if (!periodStart || !periodEnd) {
      return res.status(400).json({ error: 'Missing periodStart or periodEnd' });
    }

    const closeId = await periodCloseService.createPeriodClose(
      req.user.tenantId,
      new Date(periodStart),
      new Date(periodEnd),
      entityId
    );

    const close = await periodCloseService.getCloseStatus(closeId, req.user.tenantId);

    res.json({ close });
  } catch (error) {
    console.error('Error creating period close:', error);
    res.status(500).json({ error: 'Failed to create period close' });
  }
});

/**
 * GET /api/ledger/period-close/:id
 * Get period close status
 */
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const close = await periodCloseService.getCloseStatus(id, req.user.tenantId);

    if (!close) {
      return res.status(404).json({ error: 'Period close not found' });
    }

    res.json({ close });
  } catch (error) {
    console.error('Error fetching period close:', error);
    res.status(500).json({ error: 'Failed to fetch period close' });
  }
});

/**
 * GET /api/ledger/period-close/:id/tasks
 * Get close tasks
 */
router.get('/:id/tasks', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const tasks = await periodCloseService.getCloseTasks(id);

    res.json({ tasks });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

/**
 * POST /api/ledger/period-close/:id/start
 * Start period close
 */
router.post('/:id/start', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    await periodCloseService.startClose(id, req.user.tenantId, req.user.userId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error starting close:', error);
    res.status(500).json({ error: 'Failed to start close' });
  }
});

/**
 * POST /api/ledger/period-close/:id/execute
 * Execute close tasks
 */
router.post('/:id/execute', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const result = await periodCloseService.executeCloseTasks(id, req.user.tenantId);

    res.json({ result });
  } catch (error) {
    console.error('Error executing tasks:', error);
    res.status(500).json({ error: 'Failed to execute tasks' });
  }
});

/**
 * POST /api/ledger/period-close/:id/lock
 * Lock period
 */
router.post('/:id/lock', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    await periodCloseService.lockPeriod(id, req.user.tenantId, req.user.userId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error locking period:', error);
    res.status(500).json({ error: 'Failed to lock period' });
  }
});

/**
 * POST /api/ledger/period-close/:id/complete
 * Complete period close
 */
router.post('/:id/complete', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    await periodCloseService.completeClose(id, req.user.tenantId, req.user.userId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error completing close:', error);
    res.status(500).json({ error: 'Failed to complete close' });
  }
});

/**
 * GET /api/ledger/period-close/:id/export
 * Export close package
 */
router.get('/:id/export', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id } = req.params;
    const close = await periodCloseService.getCloseStatus(id, req.user.tenantId);

    if (!close || !close.exportPackageLocation) {
      return res.status(404).json({ error: 'Export package not available' });
    }

    // TODO: Implement actual file download from S3/storage
    // For now, return location
    res.json({ location: close.exportPackageLocation });
  } catch (error) {
    console.error('Error exporting package:', error);
    res.status(500).json({ error: 'Failed to export package' });
  }
});

/**
 * GET /api/ledger/variance-alerts
 * Get variance alerts
 */
router.get('/variance-alerts', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { startDate, endDate, periodCloseId } = req.query;

    const { db } = await import('@ai-accountant/database');

    let query = `
      SELECT id, alert_type, account_code, threshold_amount, actual_amount,
             variance_amount, variance_percentage, severity, status, created_at
      FROM variance_alerts
      WHERE tenant_id = $1
    `;
    const params: unknown[] = [req.user.tenantId];
    let paramCount = 2;

    if (periodCloseId) {
      query += ` AND period_close_id = $${paramCount++}`;
      params.push(periodCloseId);
    }

    if (startDate) {
      query += ` AND created_at >= $${paramCount++}`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND created_at <= $${paramCount++}`;
      params.push(endDate);
    }

    query += ` ORDER BY created_at DESC LIMIT 100`;

    const result = await db.query(query, params);

    const alerts = result.rows.map((row: {
      id: string;
      alert_type: string;
      account_code: string | null;
      threshold_amount: number | null;
      actual_amount: number | null;
      variance_amount: number | null;
      variance_percentage: number | null;
      severity: string;
      status: string;
      created_at: Date;
    }) => ({
      id: row.id,
      alertType: row.alert_type,
      accountCode: row.account_code || undefined,
      thresholdAmount: row.threshold_amount ? parseFloat(row.threshold_amount.toString()) : undefined,
      actualAmount: row.actual_amount ? parseFloat(row.actual_amount.toString()) : undefined,
      varianceAmount: row.variance_amount ? parseFloat(row.variance_amount.toString()) : undefined,
      variancePercentage: row.variance_percentage ? parseFloat(row.variance_percentage.toString()) : undefined,
      severity: row.severity,
      status: row.status,
      createdAt: row.created_at.toISOString(),
    }));

    res.json({ alerts });
  } catch (error) {
    console.error('Error fetching variance alerts:', error);
    res.status(500).json({ error: 'Failed to fetch variance alerts' });
  }
});

export { router as periodCloseRouter };
