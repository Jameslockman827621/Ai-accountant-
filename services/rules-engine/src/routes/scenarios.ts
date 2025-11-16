import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { scenarioPlannerService } from '../services/scenarioPlanner';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('scenario-routes');

// Create and execute scenario (Chunk 4)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { scenarioName, scenarioType, inputParameters, adjustments } = req.body;

    if (!scenarioName || !scenarioType || !inputParameters) {
      throw new ValidationError('Scenario name, type, and input parameters are required');
    }

    const scenarioId = await scenarioPlannerService.executeScenario(
      req.user.tenantId,
      scenarioName,
      scenarioType,
      inputParameters,
      adjustments || {},
      req.user.userId
    );

    res.status(201).json({ scenarioId });
  } catch (error) {
    logger.error('Create scenario failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create scenario' });
  }
});

// List scenarios (Chunk 4)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const scenarios = await scenarioPlannerService.listScenarios(req.user.tenantId);
    res.json({ scenarios });
  } catch (error) {
    logger.error('List scenarios failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to list scenarios' });
  }
});

// Get scenario by ID (Chunk 4)
router.get('/:scenarioId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { scenarioId } = req.params;
    const scenario = await scenarioPlannerService.getScenario(scenarioId);

    if (!scenario) {
      res.status(404).json({ error: 'Scenario not found' });
      return;
    }

    if (scenario.tenantId !== req.user.tenantId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    res.json({ scenario });
  } catch (error) {
    logger.error('Get scenario failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get scenario' });
  }
});

export { router as scenarioRouter };
