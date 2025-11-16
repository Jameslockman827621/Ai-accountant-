import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { validateTaxCalculation } from '../services/taxValidator';
import { checkDataAccuracy } from '../services/dataAccuracy';
import { detectAnomalies } from '../services/anomalyDetector';
import { checkConfidenceThresholds, enforceConfidenceThreshold } from '../services/confidenceThreshold';
import { ValidationError } from '@ai-accountant/shared-utils';
import { runValidationSuite } from '../services/validationSummary';
import { getLatestValidationRun } from '../services/validationRunStore';

const router = Router();
const logger = createLogger('validation-service');

// Validate tax calculation
router.post('/tax', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingType, filingData } = req.body;

    if (!filingType || !filingData) {
      throw new ValidationError('filingType and filingData are required');
    }

    const result = await validateTaxCalculation(req.user.tenantId, filingType, filingData);
    res.json(result);
  } catch (error) {
    logger.error('Tax validation failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to validate tax calculation' });
  }
});

// Check data accuracy
router.post('/accuracy', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { periodStart, periodEnd } = req.body;

    if (!periodStart || !periodEnd) {
      throw new ValidationError('periodStart and periodEnd are required');
    }

    const checks = await checkDataAccuracy(
      req.user.tenantId,
      new Date(periodStart),
      new Date(periodEnd)
    );

    res.json({ checks });
  } catch (error) {
    logger.error('Accuracy check failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to check data accuracy' });
  }
});

// Detect anomalies
router.post('/anomalies', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { periodStart, periodEnd } = req.body;

    if (!periodStart || !periodEnd) {
      throw new ValidationError('periodStart and periodEnd are required');
    }

    const anomalies = await detectAnomalies(
      req.user.tenantId,
      new Date(periodStart),
      new Date(periodEnd)
    );

    res.json({ anomalies });
  } catch (error) {
    logger.error('Anomaly detection failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to detect anomalies' });
  }
});

// Check confidence thresholds
router.get('/confidence', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const checks = await checkConfidenceThresholds(req.user.tenantId);
    res.json({ checks });
  } catch (error) {
    logger.error('Confidence check failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to check confidence thresholds' });
  }
});

// Enforce confidence threshold
router.post('/confidence/enforce', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.body;

    if (!documentId) {
      throw new ValidationError('documentId is required');
    }

    const enforced = await enforceConfidenceThreshold(documentId, req.user.tenantId);
    res.json({ enforced });
  } catch (error) {
    logger.error('Confidence enforcement failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to enforce confidence threshold' });
  }
});

const parseDate = (value: unknown, field: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${field} must be a valid date string`);
  }
  return date;
};

// Run consolidated validation suite
router.post('/summary', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { entityType, entityId, filingType, filingData, periodStart, periodEnd, includeConfidenceChecks } = req.body;

    if (!entityType || !entityId) {
      throw new ValidationError('entityType and entityId are required');
    }

    const resolvedEntityId =
      entityType === 'tenant' && entityId === 'self' ? req.user.tenantId : entityId;

    const summary = await runValidationSuite({
      tenantId: req.user.tenantId,
      entityType,
      entityId: resolvedEntityId,
      filingType,
      filingData,
      periodStart: parseDate(periodStart, 'periodStart'),
      periodEnd: parseDate(periodEnd, 'periodEnd'),
      includeConfidenceChecks,
        triggeredBy: req.user.userId,
    });

    res.json(summary);
  } catch (error) {
    logger.error('Validation summary failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to execute validation summary' });
  }
});

router.post('/runs', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { entityType, entityId, filingType, filingData, periodStart, periodEnd, includeConfidenceChecks } = req.body;

    if (!entityType || !entityId) {
      throw new ValidationError('entityType and entityId are required');
    }

    const resolvedEntityId =
      entityType === 'tenant' && entityId === 'self' ? req.user.tenantId : entityId;

    const summary = await runValidationSuite({
      tenantId: req.user.tenantId,
      entityType,
      entityId: resolvedEntityId,
      filingType,
      filingData,
      periodStart: parseDate(periodStart, 'periodStart'),
      periodEnd: parseDate(periodEnd, 'periodEnd'),
      includeConfidenceChecks,
      triggeredBy: req.user.userId,
    });

    res.status(202).json(summary);
  } catch (error) {
    logger.error('Validation run failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to run validation suite' });
  }
});

router.get('/runs/latest', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const entityType = String(req.query.entityType || '');
    const entityId = String(req.query.entityId || '');

    if (!entityType || !entityId) {
      throw new ValidationError('entityType and entityId query parameters are required');
    }

    const resolvedEntityId =
      entityType === 'tenant' && entityId === 'self' ? req.user.tenantId : entityId;

    const run = await getLatestValidationRun(req.user.tenantId, entityType, resolvedEntityId);
    if (!run) {
      res.status(404).json({ error: 'No validation run found' });
      return;
    }

    res.json({ run });
  } catch (error) {
    logger.error('Fetch validation run failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch validation run' });
  }
});

export { router as validationRouter };
