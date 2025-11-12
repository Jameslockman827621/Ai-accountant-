import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  createLedgerEntry,
  getLedgerEntries,
  reconcileEntries,
  getAccountBalance,
} from '../services/ledger';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('ledger-service');

// Create ledger entry
router.post('/entries', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      documentId,
      entryType,
      accountCode,
      accountName,
      amount,
      currency,
      description,
      transactionDate,
      taxAmount,
      taxRate,
      metadata,
      modelVersion,
      reasoningTrace,
    } = req.body;

    if (!entryType || !accountCode || !accountName || !amount || !description || !transactionDate) {
      throw new ValidationError('Missing required fields');
    }

    const entry = await createLedgerEntry(req.user.tenantId, {
      documentId,
      entryType,
      accountCode,
      accountName,
      amount: parseFloat(amount),
      currency: currency || 'GBP',
      description,
      transactionDate: new Date(transactionDate),
      taxAmount: taxAmount ? parseFloat(taxAmount) : undefined,
      taxRate: taxRate ? parseFloat(taxRate) : undefined,
      metadata,
      createdBy: req.user.userId,
      modelVersion,
      reasoningTrace,
    });

    res.status(201).json({ entry });
  } catch (error) {
    logger.error('Create entry failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create entry' });
  }
});

// Get ledger entries
router.get('/entries', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      startDate,
      endDate,
      accountCode,
      reconciled,
      page,
      limit,
    } = req.query;

    const result = await getLedgerEntries(req.user.tenantId, {
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      accountCode: accountCode as string | undefined,
      reconciled: reconciled === 'true' ? true : reconciled === 'false' ? false : undefined,
      limit: limit ? parseInt(limit as string, 10) : 100,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : 0,
    });

    res.json(result);
  } catch (error) {
    logger.error('Get entries failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get entries' });
  }
});

// Reconcile entries
router.post('/entries/reconcile', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { entryId1, entryId2 } = req.body;

    if (!entryId1 || !entryId2) {
      throw new ValidationError('Both entry IDs are required');
    }

    await reconcileEntries(req.user.tenantId, entryId1, entryId2);

    res.json({ message: 'Entries reconciled successfully' });
  } catch (error) {
    logger.error('Reconcile failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to reconcile entries' });
  }
});

// Get account balance
router.get('/accounts/:accountCode/balance', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { accountCode } = req.params;
    const { asOfDate } = req.query;

    const balance = await getAccountBalance(
      req.user.tenantId,
      accountCode,
      asOfDate ? new Date(asOfDate as string) : undefined
    );

    res.json(balance);
  } catch (error) {
    logger.error('Get balance failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

export { router as ledgerRouter };
