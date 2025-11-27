import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { AuthRequest } from '../middleware/auth';
import { db } from '@ai-accountant/database';
import {
  getAccountantClients,
  switchClientContext,
  performBulkOperation,
  getClientTasks,
  resolveClientTask,
} from '../services/multiClient';
import { firmPortalService } from '../services/firmPortal';
import { listInvoices, resolveInvoice } from '../../automation/src/services/invoiceIngestion';

const router = Router();
const logger = createLogger('accountant-service');

// Get all clients for an accountant
router.get('/clients', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.user.role !== 'accountant') {
      res.status(403).json({ error: 'Forbidden - Accountant role required' });
      return;
    }

    const clients = await getAccountantClients(req.user.userId);
    res.json({ clients });
  } catch (error) {
    logger.error('Get clients failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get clients' });
  }
});

router.get('/clients/:tenantId/tasks', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.user.role !== 'accountant') {
      res.status(403).json({ error: 'Forbidden - Accountant role required' });
      return;
    }

    const tenantId = req.params.tenantId as TenantId;
    const status = (req.query.status as string | undefined)?.toLowerCase() as
      | 'pending'
      | 'approved'
      | 'rejected'
      | 'needs_revision'
      | undefined;

    const tasks = await getClientTasks(req.user.userId, tenantId as typeof req.params.tenantId, status || 'pending');
    res.json({ tasks });
  } catch (error) {
    logger.error('Get client tasks failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to fetch client tasks' });
  }
});

router.post('/clients/:tenantId/tasks/:taskId/resolve', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.user.role !== 'accountant') {
      res.status(403).json({ error: 'Forbidden - Accountant role required' });
      return;
    }

      const tenantId = req.params.tenantId as TenantId;
      const { taskId } = req.params;
    const { action, comment } = req.body as { action: 'approve' | 'reject' | 'needs_revision'; comment?: string };

    if (!action || !['approve', 'reject', 'needs_revision'].includes(action)) {
      throw new ValidationError('Valid action is required');
    }

    await resolveClientTask(req.user.userId, tenantId, taskId, action, comment);
    res.json({ message: 'Task updated' });
  } catch (error) {
    logger.error('Resolve client task failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Switch client context
router.post('/switch-context', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.user.role !== 'accountant') {
      res.status(403).json({ error: 'Forbidden - Accountant role required' });
      return;
    }

    const { tenantId } = req.body;

    if (!tenantId) {
      throw new ValidationError('tenantId is required');
    }

    await switchClientContext(req.user.userId, tenantId);
    res.json({ message: 'Client context switched successfully' });
  } catch (error) {
    logger.error('Switch context failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to switch context' });
  }
});

// Perform bulk operation
router.post('/bulk-operation', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.user.role !== 'accountant') {
      res.status(403).json({ error: 'Forbidden - Accountant role required' });
      return;
    }

    const { tenantIds, operation, parameters } = req.body;

    if (!tenantIds || !Array.isArray(tenantIds) || tenantIds.length === 0) {
      throw new ValidationError('tenantIds array is required');
    }

    if (!operation || !['approve', 'reject', 'export', 'categorize'].includes(operation)) {
      throw new ValidationError('Valid operation is required');
    }

    const result = await performBulkOperation(tenantIds, operation, parameters || {});
    res.json(result);
  } catch (error) {
    logger.error('Bulk operation failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to perform bulk operation' });
  }
});

// Get firm overview
router.get('/firm/overview', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get user's firm
    const firmResult = await db.query<{ firm_id: string }>(
      `SELECT firm_id FROM accountant_staff WHERE user_id = $1 AND is_active = true LIMIT 1`,
      [req.user.userId]
    );

    if (firmResult.rows.length === 0) {
      res.status(404).json({ error: 'Firm not found' });
      return;
    }

    const overview = await firmPortalService.getFirmOverview(firmResult.rows[0].firm_id, req.user.userId);
    res.json({ overview });
  } catch (error) {
    logger.error('Get firm overview failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get firm overview' });
  }
});

// Get client summary
router.get('/firm/clients/:clientTenantId/summary', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get user's firm
    const firmResult = await db.query<{ firm_id: string }>(
      `SELECT firm_id FROM accountant_staff WHERE user_id = $1 AND is_active = true LIMIT 1`,
      [req.user.userId]
    );

    if (firmResult.rows.length === 0) {
      res.status(404).json({ error: 'Firm not found' });
      return;
    }

    const summary = await firmPortalService.getClientSummary(
      firmResult.rows[0].firm_id,
      req.params.clientTenantId as TenantId
    );

    if (!summary) {
      res.status(404).json({ error: 'Client not found or access denied' });
      return;
    }

    res.json({ summary });
  } catch (error) {
    logger.error('Get client summary failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get client summary' });
  }
});

// Invoice approval workflow
router.get('/clients/:tenantId/invoices', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.json({ invoices: listInvoices(req.params.tenantId as TenantId) });
});

router.post('/clients/:tenantId/invoices/:invoiceId/resolve', (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, notes } = req.body as { status: 'approved' | 'rejected'; notes?: string };
    if (!status) {
      throw new ValidationError('status is required');
    }

    const invoice = resolveInvoice(
      req.params.tenantId as TenantId,
      req.params.invoiceId,
      status,
      req.user.userId,
      notes
    );

    if (!invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    res.json({ invoice });
  } catch (error) {
    logger.error('Invoice resolution failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to resolve invoice' });
  }
});

export { router as accountantRouter };
