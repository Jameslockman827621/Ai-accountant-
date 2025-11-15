import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  getOnboardingProgress,
  completeOnboardingStep,
  getOnboardingStepData,
  resetOnboarding,
  OnboardingStep,
  recordOnboardingEvent,
  OnboardingEventType,
} from '../services/onboarding';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('onboarding-service');
const ONBOARDING_STEPS: ReadonlyArray<OnboardingStep> = [
  'welcome',
  'business_profile',
  'tax_scope',
  'chart_of_accounts',
  'bank_connection',
  'historical_import',
  'filing_preferences',
  'first_document',
  'complete',
];

const ONBOARDING_EVENT_TYPES: ReadonlyArray<OnboardingEventType> = [
  'wizard_opened',
  'wizard_closed',
  'step_viewed',
  'step_completed',
  'step_skipped',
  'journey_reset',
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

    await completeOnboardingStep(req.user.tenantId, req.user.userId, stepName, stepData);

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

    await resetOnboarding(req.user.tenantId, req.user.userId);

    res.json({ message: 'Onboarding reset successfully' });
  } catch (error) {
    logger.error('Reset onboarding failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to reset onboarding' });
  }
});

// Record telemetry event
router.post('/events', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { eventType, stepName, metadata } = req.body as {
      eventType?: string;
      stepName?: string;
      metadata?: Record<string, unknown>;
    };

    if (!eventType || typeof eventType !== 'string') {
      throw new ValidationError('Event type is required');
    }

    if (!ONBOARDING_EVENT_TYPES.includes(eventType as OnboardingEventType)) {
      throw new ValidationError('Invalid event type');
    }

    if (stepName && !isOnboardingStep(stepName)) {
      throw new ValidationError('Invalid step name');
    }

    await recordOnboardingEvent(
      req.user.tenantId,
      req.user.userId,
      eventType as OnboardingEventType,
      stepName as OnboardingStep | undefined,
      metadata
    );

    res.status(201).json({ message: 'Event recorded' });
  } catch (error) {
    logger.error('Record onboarding event failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to record onboarding event' });
  }
});

export { router as onboardingRouter };
