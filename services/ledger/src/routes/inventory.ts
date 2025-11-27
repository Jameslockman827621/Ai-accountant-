import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { listInventory, reserveInventory, upsertInventoryItem } from '../services/inventory';

const router = Router();
const logger = createLogger('ledger-inventory');

router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.json({ items: listInventory(req.user.tenantId) });
});

router.post('/', (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sku, description, onHand, reorderPoint } = req.body;
    if (!sku || !description) {
      throw new ValidationError('sku and description are required');
    }

    const item = upsertInventoryItem({
      id: `inv_${Date.now()}`,
      tenantId: req.user.tenantId,
      sku,
      description,
      onHand: Number(onHand || 0),
      reorderPoint: Number(reorderPoint || 0),
      committed: 0,
    });

    res.status(201).json({ item });
  } catch (error) {
    logger.error('Failed to upsert inventory', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to save inventory item' });
  }
});

router.post('/:sku/reserve', (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const quantity = Number(req.body.quantity || 0);
    if (!quantity) {
      throw new ValidationError('quantity is required');
    }

    const item = reserveInventory(req.user.tenantId, req.params.sku, quantity);
    if (!item) {
      res.status(404).json({ error: 'Item not found' });
      return;
    }

    res.json({ item });
  } catch (error) {
    logger.error('Failed to reserve inventory', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to reserve inventory' });
  }
});

export { router as inventoryRouter };
