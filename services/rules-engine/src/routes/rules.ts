import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { getTaxRulepack, applyTaxRules } from '../services/taxRules';
import { payrollComplianceService } from '../services/payrollCompliance';

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
    if (!country) {
      res.status(400).json({ error: 'Country is required' });
      return;
    }
    const { version } = req.query;

    const versionStr: string | undefined = version ? String(version) : undefined;
    const rulepack = await getTaxRulepack(country, versionStr);

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

router.post('/payroll/compliance', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const evaluation = await payrollComplianceService.evaluateRun(req.user.tenantId, req.body || {});
    res.json({ compliance: evaluation });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }

    logger.error('Payroll compliance check failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to evaluate payroll compliance' });
  }
});

export { router as rulesRouter };
