import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  recordError,
  getErrors,
  retryError,
  resolveError,
} from '../services/errorRecovery';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('error-handling-service');

// Get errors
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status } = req.query;

    const errors = await getErrors(req.user.tenantId, status as string | undefined);
    res.json({ errors });
  } catch (error) {
    logger.error('Get errors failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get errors' });
  }
});

// Retry error
router.post('/:errorId/retry', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { errorId } = req.params;

    const success = await retryError(errorId, req.user.tenantId);

    res.json({ success, message: success ? 'Error retry initiated' : 'Max retries reached' });
  } catch (error) {
    logger.error('Retry error failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to retry error' });
  }
});

// Resolve error
router.post('/:errorId/resolve', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { errorId } = req.params;

    await resolveError(errorId, req.user.tenantId);

    res.json({ message: 'Error resolved' });
  } catch (error) {
    logger.error('Resolve error failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to resolve error' });
  }
});

export { router as errorHandlingRouter };
