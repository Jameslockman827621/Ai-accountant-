import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  generateProfitAndLoss,
  generateBalanceSheet,
  generateCashFlow,
} from '../services/financialReports';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('reporting-service');

// Generate Profit & Loss
router.get('/profit-loss', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new ValidationError('Start date and end date are required');
    }

    const report = await generateProfitAndLoss(
      req.user.tenantId,
      new Date(startDate as string),
      new Date(endDate as string)
    );

    res.json({ report });
  } catch (error) {
    logger.error('Generate P&L failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate P&L' });
  }
});

// Generate Balance Sheet
router.get('/balance-sheet', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { asOfDate } = req.query;

    if (!asOfDate) {
      throw new ValidationError('As of date is required');
    }

    const report = await generateBalanceSheet(
      req.user.tenantId,
      new Date(asOfDate as string)
    );

    res.json({ report });
  } catch (error) {
    logger.error('Generate Balance Sheet failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate Balance Sheet' });
  }
});

// Generate Cash Flow
router.get('/cash-flow', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw new ValidationError('Start date and end date are required');
    }

    const report = await generateCashFlow(
      req.user.tenantId,
      new Date(startDate as string),
      new Date(endDate as string)
    );

    res.json({ report });
  } catch (error) {
    logger.error('Generate Cash Flow failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate Cash Flow' });
  }
});

export { router as reportingRouter };
