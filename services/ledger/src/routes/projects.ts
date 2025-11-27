import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { getProjectCosts, recordProjectCost, summarizeProjectCosts } from '../services/projectCosting';

const router = Router();
const logger = createLogger('ledger-projects');

router.get('/', (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.json({ costs: getProjectCosts(req.user.tenantId) });
});

router.post('/', (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { projectCode, description, laborHours, laborRate, materials, overheadRate } = req.body;
    if (!projectCode || !laborHours || !laborRate) {
      throw new ValidationError('projectCode, laborHours, and laborRate are required');
    }

    const record = recordProjectCost({
      id: `project_cost_${Date.now()}`,
      tenantId: req.user.tenantId,
      projectCode,
      description: description || 'Job costing entry',
      laborHours: Number(laborHours),
      laborRate: Number(laborRate),
      materials: Number(materials || 0),
      overheadRate: Number(overheadRate || 0),
    });

    res.status(201).json({ cost: record });
  } catch (error) {
    logger.error('Failed to record project cost', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Unable to save project cost' });
  }
});

router.get('/:projectCode/summary', (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const summary = summarizeProjectCosts(req.user.tenantId, req.params.projectCode);
    res.json({ summary });
  } catch (error) {
    logger.error('Failed to summarize project', error instanceof Error ? error : new Error(String(error)));
    res.status(404).json({ error: 'Project not found' });
  }
});

export { router as projectCostingRouter };
