import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { MultiEntityConsolidator } from '../services/multiEntityConsolidation';

const router = Router();
const logger = createLogger('ledger-consolidation');
const consolidator = new MultiEntityConsolidator();

router.post('/eliminations', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { parentEntityId, periodStart, periodEnd } = req.body;
    if (!parentEntityId || !periodStart || !periodEnd) {
      throw new ValidationError('parentEntityId, periodStart, and periodEnd are required');
    }

    const report = await consolidator.consolidateEntities(
      parentEntityId,
      new Date(periodStart),
      new Date(periodEnd)
    );

    res.json({
      entities: report.entities,
      eliminations: report.intercompanyEliminations,
      currencyAdjustments: report.currencyAdjustments,
      balanceSheet: report.consolidatedBalanceSheet,
      incomeStatement: report.consolidatedIncomeStatement,
    });
  } catch (error) {
    logger.error('Consolidation run failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to run consolidation' });
  }
});

export { router as consolidationRouter };
