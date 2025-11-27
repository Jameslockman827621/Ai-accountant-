import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { rulepackRegistryService } from '../services/rulepackRegistry';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('rulepack-routes');

// Check if user is compliance admin
function isComplianceAdmin(req: AuthRequest): boolean {
  if (!req.user) {
    return false;
  }
  // In production, would check user role
  return req.user.role === 'admin' || req.user.role === 'compliance_admin';
}

// Install rulepack (Chunk 1)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!isComplianceAdmin(req)) {
      res.status(403).json({ error: 'Only compliance admins can install rulepacks' });
      return;
    }

    const { jurisdiction, version, rulepackData, metadata, regressionTests } = req.body;

    if (!jurisdiction || !version || !rulepackData) {
      throw new ValidationError('Jurisdiction, version, and rulepackData are required');
    }

    const rulepackId = await rulepackRegistryService.installRulepack(
      jurisdiction,
      version,
      rulepackData,
      metadata || {},
      regressionTests || [],
      req.user.userId
    );

    res.status(201).json({ rulepackId });
  } catch (error) {
    logger.error('Install rulepack failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to install rulepack' });
  }
});

// List rulepacks (Chunk 1)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { jurisdiction } = req.query;
    const rulepacks = await rulepackRegistryService.listRulepacks(
      jurisdiction as string | undefined
    );

    res.json({ rulepacks });
  } catch (error) {
    logger.error('List rulepacks failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to list rulepacks' });
  }
});

// Ensure built-in jurisdiction coverage
router.post('/jurisdictions/bootstrap', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!isComplianceAdmin(req)) {
      res.status(403).json({ error: 'Only compliance admins can bootstrap rulepacks' });
      return;
    }

    await rulepackRegistryService.ensureBuiltInJurisdictions(req.user.userId);
    res.json({ message: 'Built-in jurisdiction rulepacks ensured' });
  } catch (error) {
    logger.error('Bootstrap jurisdictions failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to bootstrap jurisdictions' });
  }
});

// Persist tenant jurisdiction selection
router.post('/jurisdictions/select', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { primaryJurisdiction, secondaryJurisdictions } = req.body;
    if (!primaryJurisdiction) {
      throw new ValidationError('primaryJurisdiction is required');
    }

    await rulepackRegistryService.setTenantJurisdictions(
      req.user.tenantId,
      primaryJurisdiction,
      secondaryJurisdictions || []
    );

    res.json({ message: 'Jurisdictions saved' });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Select jurisdictions failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to save jurisdictions' });
  }
});

router.get('/jurisdictions/select', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const prefs = await rulepackRegistryService.getTenantJurisdictions(req.user.tenantId);
    res.json({ preferences: prefs });
  } catch (error) {
    logger.error('Get jurisdictions failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to fetch jurisdiction preferences' });
  }
});

// Get rulepack by ID
router.get('/:rulepackId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

      const rulepackId = getRequiredParam(req.params, 'rulepackId');
      const rulepack = await rulepackRegistryService.getRulepack(rulepackId);

    if (!rulepack) {
      res.status(404).json({ error: 'Rulepack not found' });
      return;
    }

    res.json({ rulepack });
  } catch (error) {
    logger.error('Get rulepack failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get rulepack' });
  }
});

// Activate rulepack (Chunk 1)
router.patch('/:rulepackId/activate', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

      if (!isComplianceAdmin(req)) {
        res.status(403).json({ error: 'Only compliance admins can activate rulepacks' });
        return;
      }

      const rulepackId = getRequiredParam(req.params, 'rulepackId');
      const { effectiveFrom } = req.body;

      await rulepackRegistryService.activateRulepack(rulepackId, req.user.userId, {
        effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
      });

      res.json({ message: 'Rulepack activated' });
  } catch (error) {
    logger.error('Activate rulepack failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to activate rulepack' });
  }
});

// Run regression tests (Chunk 1)
router.post('/:rulepackId/regression', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

      const rulepackId = getRequiredParam(req.params, 'rulepackId');
    const { runType } = req.body;

    const runId = await rulepackRegistryService.runRegressionTests(
      rulepackId,
      runType || 'manual',
      req.user.userId
    );

    res.json({ runId });
  } catch (error) {
    logger.error('Run regression tests failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to run regression tests' });
  }
});

// Get regression run
router.get('/:rulepackId/regression/:runId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

      const rulepackId = getRequiredParam(req.params, 'rulepackId');
      const runId = getRequiredParam(req.params, 'runId');
      // In production, would fetch from database
      res.json({ message: 'Regression run details', rulepackId, runId });
  } catch (error) {
    logger.error('Get regression run failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get regression run' });
  }
});

export { router as rulepackRouter };

function getRequiredParam(params: Record<string, string | undefined>, key: string): string {
  const value = params[key];
  if (!value) {
    throw new ValidationError(`${key} is required`);
  }
  return value;
}
