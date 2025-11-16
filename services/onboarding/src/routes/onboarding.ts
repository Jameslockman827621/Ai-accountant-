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
import { generateSampleData } from '../services/sampleDataGenerator';
import { tutorialEngine } from '../services/tutorialEngine';

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

// Generate sample data
router.post('/sample-data', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await generateSampleData(req.user.tenantId, req.user.userId);
    res.json({ result });
  } catch (error) {
    logger.error('Generate sample data failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to generate sample data' });
  }
});

// Get available tutorials
router.get('/tutorials', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const tutorials = tutorialEngine.getAvailableTutorials(req.user.tenantId, req.user.userId);
    res.json({ tutorials });
  } catch (error) {
    logger.error('Get tutorials failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get tutorials' });
  }
});

// Get tutorial
router.get('/tutorials/:tutorialId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { tutorialId } = req.params;
    const tutorial = tutorialEngine.getTutorial(tutorialId);

    if (!tutorial) {
      res.status(404).json({ error: 'Tutorial not found' });
      return;
    }

    res.json({ tutorial });
  } catch (error) {
    logger.error('Get tutorial failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get tutorial' });
  }
});

// Get contextual help
router.get('/help/:component', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { component } = req.params;
    const { action } = req.query;

    const help = tutorialEngine.getContextualHelp(component, action as string | undefined);
    
    if (!help) {
      res.status(404).json({ error: 'Help not found' });
      return;
    }

    res.json({ help });
  } catch (error) {
    logger.error('Get contextual help failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get contextual help' });
  }
});

// Complete tutorial step
router.post('/tutorials/:tutorialId/steps/:stepId/complete', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { tutorialId, stepId } = req.params;
    const completed = tutorialEngine.completeStep(tutorialId, stepId);

    if (!completed) {
      res.status(404).json({ error: 'Tutorial or step not found' });
      return;
    }

    res.json({ message: 'Step completed' });
  } catch (error) {
    logger.error('Complete tutorial step failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to complete tutorial step' });
  }
});

export { router as onboardingRouter };
