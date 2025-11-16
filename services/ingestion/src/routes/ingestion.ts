import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { unifiedIngestionService } from '../services/unifiedIngestion';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('ingestion-service');

// Get ingestion statistics
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.query;

    const stats = await unifiedIngestionService.getIngestionStats(
      req.user.tenantId,
      startDate ? new Date(startDate as string) : undefined,
      endDate ? new Date(endDate as string) : undefined
    );

    res.json({ stats });
  } catch (error) {
    logger.error('Get ingestion stats failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get ingestion stats' });
  }
});

// Get ingestion log
router.get('/log', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { sourceType, status, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT id, source_type, connector_provider, processing_status,
             ingested_at, processed_at, completed_at, error_message,
             classification_confidence, reconciliation_status
      FROM ingestion_log
      WHERE tenant_id = $1
    `;
    const params: unknown[] = [req.user.tenantId];
    let paramCount = 2;

    if (sourceType) {
      query += ` AND source_type = $${paramCount++}`;
      params.push(sourceType);
    }

    if (status) {
      query += ` AND processing_status = $${paramCount++}`;
      params.push(status);
    }

    query += ` ORDER BY ingested_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit as string, 10), parseInt(offset as string, 10));

    const { db } = await import('@ai-accountant/database');
    const result = await db.query(query, params);

    res.json({ log: result.rows });
  } catch (error) {
    logger.error('Get ingestion log failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get ingestion log' });
  }
});

export { router as ingestionRouter };
