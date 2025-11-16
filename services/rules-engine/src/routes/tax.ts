import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { rulepackRegistryService } from '../services/rulepackRegistry';
import { applyTaxRules } from '../services/taxRules';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('tax-routes');

// Calculate tax for jurisdiction (Chunk 1)
router.post('/:jurisdiction/calculate', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { jurisdiction } = req.params;
    const { transaction, taxType } = req.body;

    if (!transaction) {
      throw new ValidationError('Transaction data is required');
    }

    // Get active rulepack for jurisdiction
    const rulepack = await rulepackRegistryService.getActiveRulepack(jurisdiction);
    if (!rulepack) {
      res.status(404).json({ error: `No active rulepack found for jurisdiction: ${jurisdiction}` });
      return;
    }

    // Route to appropriate service based on tax type or jurisdiction
    let result;
    if (taxType === 'vat' || jurisdiction.startsWith('GB') || jurisdiction.startsWith('EU')) {
      // VAT calculation
      const { calculateVAT } = await import('../services/ukVATCalculations');
      result = await calculateVAT(transaction);
    } else if (taxType === 'income_tax' || jurisdiction.startsWith('US')) {
      // Income tax calculation
      const { calculateIncomeTax } = await import('../services/ukTaxCalculations');
      result = await calculateIncomeTax(transaction);
    } else if (taxType === 'payroll' || jurisdiction.includes('PAYE')) {
      // Payroll tax calculation
      const { calculateNationalInsurance } = await import('../services/ukTaxCalculations');
      result = await calculateNationalInsurance(transaction);
    } else {
      // Default: use generic tax rules
      result = await applyTaxRules(jurisdiction, transaction);
    }

    res.json({
      result,
      rulepack: {
        id: rulepack.id,
        version: rulepack.version,
        jurisdiction: rulepack.jurisdiction,
      },
    });
  } catch (error) {
    logger.error('Calculate tax failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to calculate tax' });
  }
});

export { router as taxRouter };
