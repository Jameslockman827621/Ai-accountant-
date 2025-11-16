import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { intentProfileService, IntentProfileInput } from '../services/intentProfile';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('onboarding-service');

// Get intent profile
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const profile = await intentProfileService.getProfile(req.user.tenantId);
    res.json({ profile });
  } catch (error) {
    logger.error('Get intent profile failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get intent profile' });
  }
});

// Create or update intent profile
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const input: IntentProfileInput = {
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      ...req.body,
    };

    if (!input.entityType || !input.businessName || !input.primaryJurisdiction) {
      throw new ValidationError('Entity type, business name, and primary jurisdiction are required');
    }

    await intentProfileService.createOrUpdateProfile(input);

    res.json({ message: 'Intent profile saved successfully' });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error('Save intent profile failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to save intent profile' });
  }
});

export { router as intentProfileRouter };
