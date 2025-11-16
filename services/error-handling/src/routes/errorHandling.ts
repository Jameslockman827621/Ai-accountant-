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
import { translateError } from '../services/userFriendlyErrors';
import { errorRecoveryEngine } from '../services/errorRecoveryEngine';

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

// Translate error to user-friendly message
router.post('/translate', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { error } = req.body;

    if (!error) {
      throw new ValidationError('error is required');
    }

    const friendlyError = translateError(error);
    res.json({ error: friendlyError });
  } catch (error) {
    logger.error('Translate error failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to translate error' });
  }
});

// Schedule retry
router.post('/retries', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { operationType, operationId, error, metadata } = req.body;

    if (!operationType || !operationId || !error) {
      throw new ValidationError('operationType, operationId, and error are required');
    }

    const retryId = await errorRecoveryEngine.scheduleRetry(
      req.user.tenantId,
      req.user.userId,
      operationType,
      operationId,
      error,
      metadata
    );

    res.json({ retryId });
  } catch (error) {
    logger.error('Schedule retry failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to schedule retry' });
  }
});

// Get retries for operation
router.get('/retries', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { operationType, operationId } = req.query;

    if (!operationType || !operationId) {
      throw new ValidationError('operationType and operationId are required');
    }

    const retries = await errorRecoveryEngine.getRetriesForOperation(
      req.user.tenantId,
      operationType as any,
      operationId as string
    );

    res.json({ retries });
  } catch (error) {
    logger.error('Get retries failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to get retries' });
  }
});

export { router as errorHandlingRouter };
