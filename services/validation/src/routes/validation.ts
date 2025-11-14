import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { validateTaxCalculation } from '../services/taxValidator';
import { checkDataAccuracy } from '../services/dataAccuracy';
import { detectAnomalies } from '../services/anomalyDetector';
import { checkConfidenceThresholds, enforceConfidenceThreshold } from '../services/confidenceThreshold';
import { ValidationError } from '@ai-accountant/shared-utils';

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

export { router as validationRouter };
