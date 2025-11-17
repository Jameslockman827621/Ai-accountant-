import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { qualityMetricsService } from '../services/qualityMetrics';
import { db } from '@ai-accountant/database';

const router = Router();
const logger = createLogger('quality-routes');

// Get quality stats
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    const stats = await qualityMetricsService.getQualityStats(req.user.tenantId, start, end);

    res.json(stats);
  } catch (error) {
    logger.error('Get quality stats failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get quality stats' });
  }
});

// Get field performance
router.get('/field-performance', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.query(
      `SELECT 
        field_name,
        AVG(accuracy) as avg_accuracy,
        AVG(completeness) as avg_completeness,
        AVG(confidence) as avg_confidence,
        COUNT(*) as sample_count
       FROM (
         SELECT 
           jsonb_object_keys(field_level_metrics) as field_name,
           (field_level_metrics->jsonb_object_keys(field_level_metrics)->>'accuracy')::numeric as accuracy,
           (field_level_metrics->jsonb_object_keys(field_level_metrics)->>'completeness')::numeric as completeness,
           (field_level_metrics->jsonb_object_keys(field_level_metrics)->>'confidence')::numeric as confidence
         FROM quality_metrics qm
         JOIN documents d ON d.id = qm.document_id
         WHERE d.tenant_id = $1
       ) subq
       GROUP BY field_name
       ORDER BY avg_accuracy DESC`,
      [req.user.tenantId]
    );

    const fields = result.rows.map((row) => ({
      fieldName: row.field_name,
      accuracy: parseFloat(row.avg_accuracy || '0'),
      completeness: parseFloat(row.avg_completeness || '0'),
      averageConfidence: parseFloat(row.avg_confidence || '0'),
      sampleCount: parseInt(row.sample_count, 10),
    }));

    res.json(fields);
  } catch (error) {
    logger.error('Get field performance failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get field performance' });
  }
});

// Get reviewer throughput
router.get('/reviewer-throughput', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.query(
      `SELECT 
        rs.user_id,
        u.name as reviewer_name,
        rs.documents_reviewed,
        rs.average_review_time_seconds,
        rs.accuracy_rate
       FROM reviewer_skills rs
       JOIN users u ON u.id = rs.user_id
       WHERE rs.user_id IN (
         SELECT DISTINCT assigned_to FROM review_queue WHERE tenant_id = $1
       )
       ORDER BY rs.documents_reviewed DESC`,
      [req.user.tenantId]
    );

    const reviewers = result.rows.map((row) => ({
      reviewerId: row.user_id,
      reviewerName: row.reviewer_name,
      documentsReviewed: parseInt(row.documents_reviewed || '0', 10),
      averageReviewTime: parseInt(row.average_review_time_seconds || '0', 10),
      accuracyRate: parseFloat(row.accuracy_rate || '0'),
    }));

    res.json(reviewers);
  } catch (error) {
    logger.error('Get reviewer throughput failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get reviewer throughput' });
  }
});

// Get time series data
router.get('/time-series', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { dateRange } = req.query;
    let days = 30;
    if (dateRange === '7d') days = 7;
    else if (dateRange === '90d') days = 90;
    else if (dateRange === 'all') days = 365;

    const result = await db.query(
      `SELECT 
        DATE(qm.calculated_at) as date,
        AVG(qm.accuracy_score) as accuracy,
        AVG(qm.completeness_score) as completeness,
        AVG(qm.compliance_risk_score) as compliance_risk,
        COUNT(*) as document_count
       FROM quality_metrics qm
       JOIN documents d ON d.id = qm.document_id
       WHERE d.tenant_id = $1
         AND qm.calculated_at >= NOW() - INTERVAL '${days} days'
       GROUP BY DATE(qm.calculated_at)
       ORDER BY date ASC`,
      [req.user.tenantId]
    );

    const timeSeries = result.rows.map((row) => ({
      date: row.date.toISOString().split('T')[0],
      accuracy: parseFloat(row.accuracy || '0'),
      completeness: parseFloat(row.completeness || '0'),
      complianceRisk: parseFloat(row.compliance_risk || '0'),
      documentCount: parseInt(row.document_count, 10),
    }));

    res.json(timeSeries);
  } catch (error) {
    logger.error('Get time series failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get time series' });
  }
});

export { router as qualityRouter };
