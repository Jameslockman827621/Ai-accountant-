import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { AuthRequest } from '../middleware/auth';
import {
  getAccountantClients,
  switchClientContext,
  performBulkOperation,
  getClientTasks,
  resolveClientTask,
} from '../services/multiClient';

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

export { router as accountantRouter };
