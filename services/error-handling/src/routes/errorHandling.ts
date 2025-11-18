import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  getErrors,
  retryError,
  resolveError,
} from '../services/errorRecovery';
import { translateError } from '../services/userFriendlyErrors';
import { errorRecoveryEngine, RetryableOperation } from '../services/errorRecoveryEngine';
import type { ErrorRecord } from '../services/errorRecovery';

const router = Router();
const logger = createLogger('error-handling-service');

const ERROR_STATUS_SET = new Set<ErrorRecord['status']>(['pending', 'retrying', 'resolved', 'failed']);
const RETRY_OPERATION_TYPE_SET = new Set<RetryableOperation['operationType']>([
  'document_processing',
  'bank_sync',
  'filing_submission',
  'tax_calculation',
  'other',
]);

function toStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' ? first : undefined;
  }

  return undefined;
}

function parseStatus(value: unknown): ErrorRecord['status'] | undefined {
  const status = toStringValue(value);
  if (!status) {
    return undefined;
  }

  return ERROR_STATUS_SET.has(status as ErrorRecord['status'])
    ? (status as ErrorRecord['status'])
    : undefined;
}

function parseOperationType(value: unknown): RetryableOperation['operationType'] | undefined {
  const operationType = toStringValue(value);
  if (!operationType) {
    return undefined;
  }

  return RETRY_OPERATION_TYPE_SET.has(operationType as RetryableOperation['operationType'])
    ? (operationType as RetryableOperation['operationType'])
    : undefined;
}

function asMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

// Get errors
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const statusFilter = parseStatus(req.query.status);
    const errors = await getErrors(req.user.tenantId, statusFilter);
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
    if (!errorId) {
      res.status(400).json({ error: 'errorId is required' });
      return;
    }

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
    if (!errorId) {
      res.status(400).json({ error: 'errorId is required' });
      return;
    }

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

    const operationType = parseOperationType(req.body.operationType);
    const operationId = toStringValue(req.body.operationId);
    const errorMessage = toStringValue(req.body.error);
    const metadata = asMetadata(req.body.metadata);

    if (!operationType || !operationId || !errorMessage) {
      throw new ValidationError('operationType, operationId, and error are required');
    }

    const retryId = await errorRecoveryEngine.scheduleRetry(
      req.user.tenantId,
      req.user.userId,
      operationType,
      operationId,
      errorMessage,
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

    const operationType = parseOperationType(req.query.operationType);
    const operationId = toStringValue(req.query.operationId);

    if (!operationType || !operationId) {
      throw new ValidationError('operationType and operationId are required');
    }

    const retries = await errorRecoveryEngine.getRetriesForOperation(
      req.user.tenantId,
      operationType,
      operationId
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
