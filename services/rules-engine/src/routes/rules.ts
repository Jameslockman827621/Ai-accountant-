import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { getTaxRulepack, applyTaxRules } from '../services/taxRules';

const router = Router();
const logger = createLogger('rules-engine-service');

// Get tax rulepack
router.get('/tax/:country', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { country } = req.params;
    const { version } = req.query;

    const rulepack = await getTaxRulepack(country, version as string | undefined);

    if (!rulepack) {
      res.status(404).json({ error: 'Tax rulepack not found' });
      return;
    }

    res.json({ rulepack });
  } catch (error) {
    logger.error('Get rulepack failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get rulepack' });
  }
});

// Apply tax rules to transaction
router.post('/tax/apply', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { country, transaction } = req.body;

    if (!country || !transaction) {
      res.status(400).json({ error: 'Country and transaction are required' });
      return;
    }

    const result = await applyTaxRules(country, transaction);

    res.json({ result });
  } catch (error) {
    logger.error('Apply tax rules failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to apply tax rules' });
  }
});

export { router as rulesRouter };
