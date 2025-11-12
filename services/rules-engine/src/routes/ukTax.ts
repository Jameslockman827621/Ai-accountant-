import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  calculateIncomeTax,
  calculateCorporationTax,
  calculateNationalInsurance,
  calculateCapitalGainsTax,
} from '../services/ukTaxCalculations';
import {
  calculateVAT,
  determineVATRate,
} from '../services/ukVATCalculations';
import {
  calculateAllReliefs,
} from '../services/ukTaxReliefs';
import {
  calculateFilingDeadlines,
} from '../services/ukFilingDeadlines';
import {
  getEntityTaxProfile,
  setEntityType,
  getAllEntityTypes,
  getEntityTypeDescription,
  UKEntityType,
} from '../services/ukTaxEntities';

const router = Router();
const logger = createLogger('rules-engine-service');

// Get entity tax profile
router.get('/entity-profile', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const profile = await getEntityTaxProfile(req.user.tenantId);
    res.json({ profile });
  } catch (error) {
    logger.error('Get entity profile failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get entity profile' });
  }
});

// Set entity type
router.post('/entity-type', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { entityType } = req.body;
    if (!entityType || !getAllEntityTypes().includes(entityType)) {
      res.status(400).json({ error: 'Invalid entity type' });
      return;
    }

    await setEntityType(req.user.tenantId, entityType as UKEntityType);
    res.json({ message: 'Entity type updated', entityType });
  } catch (error) {
    logger.error('Set entity type failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to set entity type' });
  }
});

// Get all entity types
router.get('/entity-types', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const types = getAllEntityTypes().map(type => ({
      type,
      description: getEntityTypeDescription(type),
    }));

    res.json({ entityTypes: types });
  } catch (error) {
    logger.error('Get entity types failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get entity types' });
  }
});

// Calculate Income Tax
router.post('/calculate/income-tax', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { totalIncome, dividendIncome, savingsIncome, otherIncome } = req.body;

    const calculation = await calculateIncomeTax(
      req.user.tenantId,
      totalIncome || 0,
      dividendIncome || 0,
      savingsIncome || 0,
      otherIncome || 0
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate income tax failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate income tax' });
  }
});

// Calculate Corporation Tax
router.post('/calculate/corporation-tax', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { profitBeforeTax, adjustments } = req.body;

    const calculation = await calculateCorporationTax(
      req.user.tenantId,
      profitBeforeTax || 0,
      adjustments || 0
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate corporation tax failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate corporation tax' });
  }
});

// Calculate National Insurance
router.post('/calculate/national-insurance', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { profits, salary, weeks } = req.body;

    const calculation = await calculateNationalInsurance(
      req.user.tenantId,
      profits || 0,
      salary || 0,
      weeks || 52
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate national insurance failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate national insurance' });
  }
});

// Calculate VAT
router.post('/calculate/vat', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { transactions, periodStart, periodEnd, useFlatRateScheme, flatRateCategory } = req.body;

    const calculation = await calculateVAT(
      req.user.tenantId,
      transactions || [],
      new Date(periodStart),
      new Date(periodEnd),
      useFlatRateScheme || false,
      flatRateCategory || 'general'
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate VAT failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate VAT' });
  }
});

// Calculate Capital Gains Tax
router.post('/calculate/capital-gains-tax', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { gains, losses, isEntrepreneursRelief, entrepreneursReliefUsed } = req.body;

    const calculation = await calculateCapitalGainsTax(
      req.user.tenantId,
      gains || 0,
      losses || 0,
      isEntrepreneursRelief || false,
      entrepreneursReliefUsed || 0
    );

    res.json({ calculation });
  } catch (error) {
    logger.error('Calculate capital gains tax failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate capital gains tax' });
  }
});

// Calculate Tax Reliefs
router.post('/calculate/reliefs', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const reliefs = await calculateAllReliefs(req.user.tenantId, req.body);
    res.json({ reliefs });
  } catch (error) {
    logger.error('Calculate reliefs failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to calculate reliefs' });
  }
});

// Get Filing Deadlines
router.get('/filing-deadlines', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { asOfDate } = req.query;
    const deadlines = await calculateFilingDeadlines(
      req.user.tenantId,
      asOfDate ? new Date(asOfDate as string) : new Date()
    );

    res.json({ deadlines });
  } catch (error) {
    logger.error('Get filing deadlines failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get filing deadlines' });
  }
});

// Determine VAT Rate
router.post('/vat-rate', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { category, description } = req.body;
    const profile = await getEntityTaxProfile(req.user.tenantId);
    const isCharity = profile.entityType === 'charity';

    const vatRate = determineVATRate(category || '', description || '', isCharity);

    res.json({ vatRate, category, description });
  } catch (error) {
    logger.error('Determine VAT rate failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to determine VAT rate' });
  }
});

export { router as ukTaxRouter };
