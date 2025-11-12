import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { findMatches, reconcileTransaction } from '../services/matcher';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('reconciliation-service');

// Find matches for a bank transaction
router.get('/matches/:transactionId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { transactionId } = req.params;

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

export { router as reconciliationRouter };
