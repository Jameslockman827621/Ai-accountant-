import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { rulepackRegistryService } from '../../../rules-engine/src/services/rulepackRegistry';
import { rulepackGitRepository } from '../../../rules-engine/src/services/rulepackGitRepository';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const logger = createLogger('rulepack-registry-routes');

function ensureComplianceAdmin(req: AuthRequest): void {
  if (!req.user) {
    throw new ValidationError('Unauthorized');
  }

  if (req.user.role !== 'admin' && req.user.role !== 'compliance_admin') {
    throw new ValidationError('Only compliance admins can perform this action');
  }
}

router.get('/', async (_req: AuthRequest, res: Response) => {
  const rulepacks = await rulepackRegistryService.listRulepacks();
  res.json({ rulepacks });
});

router.post('/', async (req: AuthRequest, res: Response) => {
  ensureComplianceAdmin(req);

  const { jurisdiction, version, rulepackData, metadata, regressionTests, changeType, description, sourceControlRef } =
    req.body;

  if (!jurisdiction || !rulepackData) {
    throw new ValidationError('Jurisdiction and rulepackData are required');
  }

  const rulepackId = await rulepackRegistryService.installRulepack(
    jurisdiction,
    version,
    rulepackData,
    metadata,
    regressionTests,
    req.user!.userId,
    {
      changeType,
      description,
      sourceControlRef,
    }
  );

  res.status(201).json({ rulepackId });
});

router.get('/dashboard/overview', async (_req: AuthRequest, res: Response) => {
  const dashboard = await rulepackRegistryService.getRegressionDashboard();
  res.json({ dashboard });
});

router.get('/:rulepackId', async (req: AuthRequest, res: Response) => {
  const rulepack = await rulepackRegistryService.getRulepack(req.params.rulepackId);
  if (!rulepack) {
    res.status(404).json({ error: 'Rulepack not found' });
    return;
  }

  res.json({ rulepack });
});

router.post('/:rulepackId/submit', async (req: AuthRequest, res: Response) => {
  ensureComplianceAdmin(req);
  const { checklist } = req.body;

  await rulepackRegistryService.submitRulepackForApproval(
    req.params.rulepackId,
    req.user!.userId,
    Array.isArray(checklist) ? checklist : []
  );

  res.json({ message: 'Rulepack submitted for approval' });
});

router.post('/:rulepackId/approve', async (req: AuthRequest, res: Response) => {
  ensureComplianceAdmin(req);
  const { notes, effectiveFrom, releaseChannel, allowOverride } = req.body;

  await rulepackRegistryService.approveRulepack(req.params.rulepackId, req.user!.userId, {
    notes,
    effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
    releaseChannel,
    allowOverride: Boolean(allowOverride),
  });

  res.json({ message: 'Rulepack approved' });
});

router.post('/:rulepackId/canary', async (req: AuthRequest, res: Response) => {
  ensureComplianceAdmin(req);
  const { tenantIds, rolloutPercent, startAt, endAt } = req.body;

  if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
    throw new ValidationError('tenantIds array is required');
  }

  await rulepackRegistryService.scheduleCanaryRollout(req.params.rulepackId, tenantIds, rolloutPercent ?? 10, {
    startAt: startAt ? new Date(startAt) : undefined,
    endAt: endAt ? new Date(endAt) : undefined,
  });

  res.json({ message: 'Canary rollout scheduled' });
});

router.patch('/:rulepackId/activate', async (req: AuthRequest, res: Response) => {
  ensureComplianceAdmin(req);

  const { effectiveFrom, releaseChannel, allowOverride } = req.body;

  await rulepackRegistryService.activateRulepack(req.params.rulepackId, req.user!.userId, {
    effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : undefined,
    releaseChannel,
    allowOverride: Boolean(allowOverride),
  });

  res.json({ message: 'Rulepack activated' });
});

router.post('/:rulepackId/regression', async (req: AuthRequest, res: Response) => {
  ensureComplianceAdmin(req);

  const { runType, blocking } = req.body;

  if (blocking) {
    const run = await rulepackRegistryService.runRegressionTestsBlocking(
      req.params.rulepackId,
      runType || 'manual',
      req.user!.userId
    );
    res.json({ run });
    return;
  }

  const runId = await rulepackRegistryService.runRegressionTests(
    req.params.rulepackId,
    runType || 'manual',
    req.user!.userId
  );

  res.json({ runId });
});

router.get('/:rulepackId/regression/latest', async (req: AuthRequest, res: Response) => {
  const run = await rulepackRegistryService.getLatestRegressionRun(req.params.rulepackId);
  res.json({ run });
});

router.get('/:rulepackId/regression/:runId', async (req: AuthRequest, res: Response) => {
  const run = await rulepackRegistryService.getRegressionRun(req.params.runId);
  if (!run) {
    res.status(404).json({ error: 'Run not found' });
    return;
  }
  res.json({ run });
});

router.get('/:rulepackId/diff', async (req: AuthRequest, res: Response) => {
  const { compareTo } = req.query;

  if (!compareTo || typeof compareTo !== 'string') {
    throw new ValidationError('compareTo version is required');
  }

  const rulepack = await rulepackRegistryService.getRulepack(req.params.rulepackId);
  if (!rulepack) {
    res.status(404).json({ error: 'Rulepack not found' });
    return;
  }

  try {
    const diff = await rulepackGitRepository.diffSnapshots(
      rulepack.jurisdiction,
      compareTo,
      rulepack.version
    );
    res.json({ diff });
  } catch (error) {
    logger.error('Diff generation failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Unable to generate diff' });
  }
});

router.get('/:rulepackId/snapshots', async (req: AuthRequest, res: Response) => {
  const rulepack = await rulepackRegistryService.getRulepack(req.params.rulepackId);
  if (!rulepack) {
    res.status(404).json({ error: 'Rulepack not found' });
    return;
  }

  const snapshots = await rulepackGitRepository.listSnapshots(rulepack.jurisdiction);
  res.json({ snapshots });
});

export const rulepackRouter = router;
