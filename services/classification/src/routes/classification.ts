import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { ValidationError } from '@ai-accountant/shared-utils';
import { detectDuplicates } from '../services/duplicateDetection';
import { assessDocumentQuality } from '../services/qualityAssessment';
import {
  getReviewQueue,
  assignReviewItem,
  completeReviewItem,
} from '../services/reviewQueueManager';

const router = Router();
const logger = createLogger('classification-service');

// Detect duplicates
router.post('/documents/:documentId/duplicates', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    if (!documentId) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }

    const result = await detectDuplicates(req.user.tenantId, documentId);

    res.json({ result });
  } catch (error) {
    logger.error(
      'Detect duplicates failed',
      error instanceof Error ? error : new Error(String(error))
    );
    res.status(500).json({ error: 'Failed to detect duplicates' });
  }
});

// Assess document quality
router.post('/documents/:documentId/quality', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    if (!documentId) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }

    const assessment = await assessDocumentQuality(req.user.tenantId, documentId);

    res.json({ assessment });
  } catch (error) {
    logger.error(
      'Assess document quality failed',
      error instanceof Error ? error : new Error(String(error))
    );
    res.status(500).json({ error: 'Failed to assess document quality' });
  }
});

// Get review queue
router.get('/review-queue', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { priority, limit } = req.query;
    const queue = await getReviewQueue(
      req.user.tenantId,
      priority as any,
      limit ? parseInt(limit as string, 10) : 50
    );

    res.json({ queue });
  } catch (error) {
    logger.error(
      'Get review queue failed',
      error instanceof Error ? error : new Error(String(error))
    );
    res.status(500).json({ error: 'Failed to get review queue' });
  }
});

// Assign review item
router.post('/review-queue/:documentId/assign', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    if (!documentId) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }

    await assignReviewItem(req.user.tenantId, documentId, req.user.id);

    res.json({ message: 'Review item assigned' });
  } catch (error) {
    logger.error(
      'Assign review item failed',
      error instanceof Error ? error : new Error(String(error))
    );
    res.status(500).json({ error: 'Failed to assign review item' });
  }
});

// Complete review item
router.post('/review-queue/:documentId/complete', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const { approved, notes } = req.body;

    if (typeof approved !== 'boolean') {
      throw new ValidationError('approved (boolean) is required');
    }

    if (!documentId) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }

    await completeReviewItem(req.user.tenantId, documentId, approved, notes);

    res.json({ message: 'Review item completed' });
  } catch (error) {
    logger.error(
      'Complete review item failed',
      error instanceof Error ? error : new Error(String(error))
    );
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to complete review item' });
  }
});

export { router as classificationRouter };
