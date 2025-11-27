import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { applyBulkAction, getReviewQueue } from '../services/reviewQueueService';

const allowedActions = ['approve', 'reject', 'escalate', 'retry', 'resolve'] as const;
type ActionType = (typeof allowedActions)[number];

const router = Router();
const logger = createLogger('quality-review-queue-routes');

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, riskLevel } = req.query;
    const queue = await getReviewQueue(req.user.tenantId, {
      status: status as any,
      riskLevel: riskLevel as any,
    });

    res.json({ queue });
  } catch (error) {
    logger.error('Get review queue failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to load review queue' });
  }
});

router.post('/actions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { reviewQueueIds, action, notes, fieldCorrections, ledgerCorrections, taskToken } = req.body as {
      reviewQueueIds: string[];
      action: ActionType;
      notes?: string;
      fieldCorrections?: Record<string, unknown>;
      ledgerCorrections?: Record<string, unknown>;
      taskToken?: string;
    };

    if (!Array.isArray(reviewQueueIds) || reviewQueueIds.length === 0) {
      throw new ValidationError('At least one reviewQueueId is required');
    }

    if (!action) {
      throw new ValidationError('Action is required');
    }

    if (!allowedActions.includes(action)) {
      throw new ValidationError('Unsupported action type');
    }

    await applyBulkAction(req.user.tenantId, reviewQueueIds, {
      reviewerId: req.user.userId,
      action,
      notes,
      fieldCorrections,
      ledgerCorrections,
      taskToken,
    });

    res.json({ message: 'Actions applied' });
  } catch (error) {
    logger.error('Apply review queue action failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to apply actions' });
  }
});

export { router as reviewQueueRouter };
