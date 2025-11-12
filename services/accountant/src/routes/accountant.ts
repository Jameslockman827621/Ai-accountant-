import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  getAccountantClients,
  switchClientContext,
  performBulkOperation,
} from '../services/multiClient';
import { ValidationError } from '@ai-accountant/shared-utils';

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
