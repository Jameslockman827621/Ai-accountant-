import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { ValidationError } from '@ai-accountant/shared-utils';
import { findMatches, reconcileTransaction } from '../services/matcher';
import {
  listReconciliationExceptions,
  resolveReconciliationException,
} from '../services/exceptions';
import {
  getReconciliationSummary,
  getReconciliationTrends,
} from '../services/summary';
import {
  getTransactionSplits,
  replaceTransactionSplits,
  deleteTransactionSplits,
  submitTransactionSplits,
  approveTransactionSplits,
  rejectTransactionSplits,
} from '../services/transactionSplits';

const router = Router();
const logger = createLogger('reconciliation-service');

// Find matches for a bank transaction
router.get('/transactions/:transactionId/splits', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { transactionId } = req.params;
    if (!transactionId) {
      res.status(400).json({ error: 'Transaction ID is required' });
      return;
    }

    const summary = await getTransactionSplits(req.user.tenantId, transactionId);
    res.json(summary);
  } catch (error) {
    logger.error('Get transaction splits failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch transaction splits' });
  }
});

router.put('/transactions/:transactionId/splits', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { transactionId } = req.params;
    const { splits } = req.body ?? {};

    if (!transactionId) {
      throw new ValidationError('Transaction ID is required');
    }
    if (!Array.isArray(splits)) {
      throw new ValidationError('splits array is required');
    }

    const summary = await replaceTransactionSplits(
      req.user.tenantId,
      transactionId,
      req.user.userId,
      splits
    );

    res.json(summary);
  } catch (error) {
    logger.error('Replace transaction splits failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to save transaction splits' });
  }
});

router.delete('/transactions/:transactionId/splits', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { transactionId } = req.params;
    if (!transactionId) {
      throw new ValidationError('Transaction ID is required');
    }

    await deleteTransactionSplits(req.user.tenantId, transactionId);
    res.status(204).send();
  } catch (error) {
    logger.error('Delete transaction splits failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to delete transaction splits' });
  }
});

router.post('/transactions/:transactionId/splits/submit', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { transactionId } = req.params;
    if (!transactionId) {
      throw new ValidationError('Transaction ID is required');
    }

    const summary = await submitTransactionSplits(req.user.tenantId, transactionId, req.user.userId);
    res.json(summary);
  } catch (error) {
    logger.error('Submit transaction splits failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to submit transaction splits' });
  }
});

router.post('/transactions/:transactionId/splits/approve', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { transactionId } = req.params;
    const { notes } = req.body ?? {};

    if (!transactionId) {
      throw new ValidationError('Transaction ID is required');
    }

    const summary = await approveTransactionSplits(req.user.tenantId, transactionId, req.user.userId, {
      reviewerNotes: notes || null,
    });

    res.json(summary);
  } catch (error) {
    logger.error('Approve transaction splits failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to approve transaction splits' });
  }
});

router.post('/transactions/:transactionId/splits/reject', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { transactionId } = req.params;
    const { reason } = req.body ?? {};

    if (!transactionId) {
      throw new ValidationError('Transaction ID is required');
    }

    const summary = await rejectTransactionSplits(req.user.tenantId, transactionId, req.user.userId, reason);
    res.json(summary);
  } catch (error) {
    logger.error('Reject transaction splits failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to reject transaction splits' });
  }
});

router.get('/matches/:transactionId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { transactionId } = req.params;
    if (!transactionId) {
      res.status(400).json({ error: 'Transaction ID is required' });
      return;
    }

    const matches = await findMatches(req.user.tenantId, transactionId);

    res.json({ matches });
  } catch (error) {
    logger.error('Find matches failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to find matches' });
  }
});

// Reconcile a transaction
router.post('/reconcile', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { transactionId, documentId, ledgerEntryId } = req.body;

    if (!transactionId) {
      throw new ValidationError('Transaction ID is required');
    }

    if (!documentId && !ledgerEntryId) {
      throw new ValidationError('Either documentId or ledgerEntryId must be provided');
    }

    await reconcileTransaction(req.user.tenantId, transactionId, documentId, ledgerEntryId);

    res.json({ message: 'Transaction reconciled successfully' });
  } catch (error) {
    logger.error('Reconcile failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to reconcile transaction' });
  }
});

router.get('/exceptions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const statusParam = (req.query.status as string | undefined)?.toLowerCase() as
      | 'open'
      | 'in_review'
      | 'resolved'
      | undefined;
    const status = statusParam ?? 'open';

    const exceptions = await listReconciliationExceptions(req.user.tenantId, status);
    res.json({ exceptions });
  } catch (error) {
    logger.error('List exceptions failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to fetch reconciliation exceptions' });
  }
});

router.post('/exceptions/:exceptionId/resolve', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { exceptionId } = req.params;
    const { resolution } = req.body;

    if (!exceptionId) {
      throw new ValidationError('exceptionId is required');
    }

    await resolveReconciliationException(
      req.user.tenantId,
      exceptionId,
      req.user.userId,
      resolution
    );

    res.json({ message: 'Exception resolved' });
  } catch (error) {
    logger.error('Resolve exception failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to resolve exception' });
  }
});

router.get('/summary', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const summary = await getReconciliationSummary(req.user.tenantId);
    res.json({ summary });
  } catch (error) {
    logger.error('Get reconciliation summary failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to fetch reconciliation summary' });
  }
});

router.get('/summary/trend', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const daysParam = parseInt(String(req.query.days ?? '30'), 10);
    const days = Number.isNaN(daysParam) ? 30 : Math.max(7, Math.min(daysParam, 90));

    const trend = await getReconciliationTrends(req.user.tenantId, days);
    res.json({ trend });
  } catch (error) {
    logger.error('Get reconciliation trends failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to fetch reconciliation trends' });
  }
});

export { router as reconciliationRouter };
