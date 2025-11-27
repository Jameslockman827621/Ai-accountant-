import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { addFixedAsset, getDepreciationSchedule, getFixedAssets } from '../services/fixedAssets';

const router = Router();
const logger = createLogger('ledger-fixed-assets');

router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.json({ assets: getFixedAssets(req.user.tenantId) });
});

router.post('/', (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, category, acquisitionDate, cost, usefulLifeMonths, salvageValue, method } = req.body;
    if (!name || !category || !acquisitionDate || !cost || !usefulLifeMonths) {
      throw new ValidationError('Name, category, acquisition date, cost, and useful life are required');
    }

    const asset = addFixedAsset({
      id: `asset_${Date.now()}`,
      tenantId: req.user.tenantId,
      name,
      category,
      acquisitionDate,
      cost: Number(cost),
      usefulLifeMonths: Number(usefulLifeMonths),
      salvageValue: Number(salvageValue || 0),
      method: (method as 'straight_line' | 'declining_balance') || 'straight_line',
    });

    res.status(201).json({ asset });
  } catch (error) {
    logger.error('Failed to register asset', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to create asset' });
  }
});

router.get('/:assetId/depreciation', (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const schedule = getDepreciationSchedule(req.params.assetId);
    res.json({ schedule });
  } catch (error) {
    logger.error('Failed to load depreciation schedule', error instanceof Error ? error : new Error(String(error)));
    res.status(404).json({ error: 'Schedule not found' });
  }
});

export { router as fixedAssetsRouter };
