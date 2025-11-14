import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  getOnboardingProgress,
  completeOnboardingStep,
  getOnboardingStepData,
  resetOnboarding,
  OnboardingStep,
} from '../services/onboarding';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('onboarding-service');
const ONBOARDING_STEPS: ReadonlyArray<OnboardingStep> = [
  'welcome',
  'business_info',
  'chart_of_accounts',
  'bank_connection',
  'first_document',
  'complete',
];

function isOnboardingStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && ONBOARDING_STEPS.includes(value as OnboardingStep);
}

// Get onboarding progress
router.get('/progress', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const progress = await getOnboardingProgress(req.user.tenantId);
    res.json({ progress });
  } catch (error) {
    logger.error('Get onboarding progress failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get onboarding progress' });
  }
});

// Complete onboarding step
router.post('/steps/:stepName/complete', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { stepName } = req.params;
    if (!isOnboardingStep(stepName)) {
      throw new ValidationError('Invalid step name');
    }
    const { stepData } = req.body;

    await completeOnboardingStep(req.user.tenantId, stepName, stepData);

    res.json({ message: 'Step completed successfully' });
  } catch (error) {
    logger.error('Complete step failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to complete step' });
  }
});

// Get step data
router.get('/steps/:stepName', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { stepName } = req.params;
    if (!isOnboardingStep(stepName)) {
      throw new ValidationError('Invalid step name');
    }

    const stepData = await getOnboardingStepData(req.user.tenantId, stepName);

    res.json({ stepData });
  } catch (error) {
    logger.error('Get step data failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get step data' });
  }
});

// Reset onboarding
router.post('/reset', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await resetOnboarding(req.user.tenantId);

    res.json({ message: 'Onboarding reset successfully' });
  } catch (error) {
    logger.error('Reset onboarding failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to reset onboarding' });
  }
});

export { router as onboardingRouter };
