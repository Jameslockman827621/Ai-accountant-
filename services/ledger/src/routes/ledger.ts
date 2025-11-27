import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { enforceIdempotency } from '../middleware/idempotency';
import {
  createLedgerEntry,
  getLedgerEntries,
  reconcileEntries,
  getAccountBalance,
  CreateLedgerEntryInput,
} from '../services/ledger';
import { postDoubleEntry, postDocumentToLedger } from '../services/posting';
import {
  initializeChartOfAccounts,
  getChartOfAccounts,
  validateAccount,
  updateChartOfAccounts,
} from '../services/chartOfAccounts';
import { ValidationError } from '@ai-accountant/shared-utils';
import { detectDuplicateLedgerEntries } from '../services/duplicateDetection';

const router = Router();
const logger = createLogger('ledger-service');

router.use(enforceIdempotency);

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

    const entryInput: CreateLedgerEntryInput = {
      entryType,
      accountCode,
      accountName,
      amount: parseFloat(amount),
      currency: currency || 'GBP',
      description,
      transactionDate: new Date(transactionDate),
      createdBy: req.user.userId,
    };
    
    if (documentId) {
      entryInput.documentId = documentId;
    }
    if (taxAmount) {
      entryInput.taxAmount = parseFloat(taxAmount);
    }
    if (taxRate) {
      entryInput.taxRate = parseFloat(taxRate);
    }
    if (metadata) {
      entryInput.metadata = metadata;
    }
    if (modelVersion) {
      entryInput.modelVersion = modelVersion;
    }
    if (reasoningTrace) {
      entryInput.reasoningTrace = reasoningTrace;
    }

    const entry = await createLedgerEntry(req.user.tenantId, entryInput);

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

    const filters: {
      startDate?: Date;
      endDate?: Date;
      accountCode?: string;
      reconciled?: boolean;
      limit?: number;
      offset?: number;
    } = {
      limit: limit ? parseInt(limit as string, 10) : 100,
      offset: page ? (parseInt(page as string, 10) - 1) * (limit ? parseInt(limit as string, 10) : 100) : 0,
    };

    if (startDate) {
      filters.startDate = new Date(startDate as string);
    }
    if (endDate) {
      filters.endDate = new Date(endDate as string);
    }
    if (accountCode) {
      filters.accountCode = accountCode as string;
    }
    if (reconciled === 'true') {
      filters.reconciled = true;
    } else if (reconciled === 'false') {
      filters.reconciled = false;
    }

    const result = await getLedgerEntries(req.user.tenantId, filters);

    res.json({
      entries: result.entries,
      pagination: {
        total: result.total,
        limit: filters.limit || 100,
        offset: filters.offset || 0,
      },
    });
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
    if (!accountCode) {
      res.status(400).json({ error: 'Account code is required' });
      return;
    }
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

router.get('/entries/:entryId/duplicates', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { entryId } = req.params;
    if (!entryId) {
      res.status(400).json({ error: 'Entry ID is required' });
      return;
    }

    const duplicates = await detectDuplicateLedgerEntries(req.user.tenantId, entryId);
    res.json({ duplicates });
  } catch (error) {
    logger.error('Duplicate detection failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to detect duplicate entries' });
  }
});

// Post double-entry transaction
router.post('/transactions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const {
      documentId,
      description,
      transactionDate,
      entries,
      metadata,
    } = req.body;

    if (!description || !transactionDate || !entries || !Array.isArray(entries) || entries.length < 2) {
      throw new ValidationError('description, transactionDate, and at least 2 entries are required');
    }

    const result = await postDoubleEntry({
      tenantId: req.user.tenantId,
      documentId,
      description,
      transactionDate: new Date(transactionDate),
      entries,
      createdBy: req.user.userId,
      metadata,
    });

    res.status(201).json({ transaction: result });
  } catch (error) {
    logger.error('Post transaction failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to post transaction' });
  }
});

// Post document to ledger
router.post('/documents/:documentId/post', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;

    const result = await postDocumentToLedger(req.user.tenantId, documentId, req.user.userId);

    res.status(201).json({ transaction: result, message: 'Document posted to ledger' });
  } catch (error) {
    logger.error('Post document to ledger failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to post document to ledger' });
  }
});

// Initialize chart of accounts
router.post('/chart-of-accounts/initialize', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await initializeChartOfAccounts(req.user.tenantId);

    res.json({ message: 'Chart of accounts initialized' });
  } catch (error) {
    logger.error('Initialize chart of accounts failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to initialize chart of accounts' });
  }
});

// Get chart of accounts
router.get('/chart-of-accounts', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const accounts = await getChartOfAccounts(req.user.tenantId);
    res.json({ accounts });
  } catch (error) {
    logger.error('Get chart of accounts failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get chart of accounts' });
  }
});

// Update chart of accounts
router.put('/chart-of-accounts', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { accounts } = req.body;

    if (!accounts || !Array.isArray(accounts)) {
      throw new ValidationError('accounts array is required');
    }

    await updateChartOfAccounts(req.user.tenantId, accounts);

    res.json({ message: 'Chart of accounts updated' });
  } catch (error) {
    logger.error('Update chart of accounts failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to update chart of accounts' });
  }
});

export { router as ledgerRouter };
