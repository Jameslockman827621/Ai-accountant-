import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { enhancedReviewQueueManager } from '../services/enhancedReviewQueue';
import { feedbackLoopService } from '../services/feedbackLoop';

const router = Router();
const logger = createLogger('review-queue-routes');

// Get review queue
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { riskLevel, status, limit, reviewerSkill } = req.query;

    const queue = await enhancedReviewQueueManager.getQueue(req.user.tenantId, {
      riskLevel: riskLevel as any,
      status: status as any,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      reviewerSkill: reviewerSkill as string,
    });

    res.json({ queue });
  } catch (error) {
    logger.error('Get review queue failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get review queue' });
  }
});

// Get next document for review
router.get('/next', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const queue = await enhancedReviewQueueManager.getQueue(req.user.tenantId, {
      status: 'pending',
      reviewerSkill: req.user.role, // Match by role
      limit: 1,
    });

    if (queue.length === 0) {
      res.json({ document: null });
      return;
    }

    const item = queue[0];
    
    // Load full document data
    const { db } = await import('@ai-accountant/database');
    const docResult = await db.query(
      `SELECT d.*, qm.*, rt.*
       FROM documents d
       LEFT JOIN quality_metrics qm ON qm.document_id = d.id
       LEFT JOIN reasoning_traces rt ON rt.document_id = d.id AND rt.trace_type = 'classification'
       WHERE d.id = $1`,
      [item.documentId]
    );

    if (docResult.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const doc = docResult.rows[0];
    
    res.json({
      sample: {
        id: item.id,
        document: {
          id: doc.id,
          fileName: doc.file_name,
          documentType: doc.document_type,
          extractedFields: doc.extracted_data || {},
          suggestedLedgerPosting: doc.extracted_data?.suggestedLedgerPosting,
          reasoningTrace: doc.decision_path ? {
            decisionPath: doc.decision_path,
            features: doc.features || {},
            weights: doc.weights || {},
          } : undefined,
          qualityMetrics: doc.accuracy_score ? {
            accuracyScore: parseFloat(doc.accuracy_score),
            completenessScore: parseFloat(doc.completeness_score),
            complianceRiskScore: parseFloat(doc.compliance_risk_score),
            compositeQualityScore: parseFloat(doc.composite_quality_score),
          } : undefined,
        },
      },
    });
  } catch (error) {
    logger.error('Get next document failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get next document' });
  }
});

// Get document by queue ID
router.get('/:queueId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { queueId } = req.params;
    const { db } = await import('@ai-accountant/database');
    
    const queueResult = await db.query(
      `SELECT * FROM review_queue WHERE id = $1 AND tenant_id = $2`,
      [queueId, req.user.tenantId]
    );

    if (queueResult.rows.length === 0) {
      res.status(404).json({ error: 'Queue item not found' });
      return;
    }

    const item = queueResult.rows[0];
    
    // Load document
    const docResult = await db.query(
      `SELECT d.*, qm.*, rt.*
       FROM documents d
       LEFT JOIN quality_metrics qm ON qm.document_id = d.id
       LEFT JOIN reasoning_traces rt ON rt.document_id = d.id AND rt.trace_type = 'classification'
       WHERE d.id = $1`,
      [item.document_id]
    );

    if (docResult.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const doc = docResult.rows[0];
    
    res.json({
      document: {
        id: doc.id,
        fileName: doc.file_name,
        documentType: doc.document_type,
        extractedFields: doc.extracted_data || {},
        suggestedLedgerPosting: doc.extracted_data?.suggestedLedgerPosting,
        reasoningTrace: doc.decision_path ? {
          decisionPath: doc.decision_path,
          features: doc.features || {},
          weights: doc.weights || {},
        } : undefined,
        qualityMetrics: doc.accuracy_score ? {
          accuracyScore: parseFloat(doc.accuracy_score),
          completenessScore: parseFloat(doc.completeness_score),
          complianceRiskScore: parseFloat(doc.compliance_risk_score),
          compositeQualityScore: parseFloat(doc.composite_quality_score),
        } : undefined,
      },
    });
  } catch (error) {
    logger.error('Get document failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get document' });
  }
});

// Assign to reviewer
router.post('/:queueId/assign', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { queueId } = req.params;
    const reviewerId = req.body.reviewerId || req.user.id;

    await enhancedReviewQueueManager.assignToReviewer(
      queueId,
      reviewerId,
      req.user.tenantId
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Assign failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to assign' });
  }
});

// Approve
router.post('/:documentId/approve', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const { fieldCorrections, ledgerCorrections, notes } = req.body;

    // Get queue ID
    const { db } = await import('@ai-accountant/database');
    const queueResult = await db.query(
      `SELECT id FROM review_queue WHERE document_id = $1 AND tenant_id = $2`,
      [documentId, req.user.tenantId]
    );

    if (queueResult.rows.length === 0) {
      res.status(404).json({ error: 'Queue item not found' });
      return;
    }

    const queueId = queueResult.rows[0].id;

    // Complete review
    await enhancedReviewQueueManager.completeReview(queueId, req.user.id, 'approve', {
      fieldCorrections,
      ledgerCorrections,
      notes,
    });

    // Process feedback
    await feedbackLoopService.processFeedback(req.user.tenantId, {
      documentId,
      reviewerId: req.user.id,
      action: 'approve',
      fieldCorrections: fieldCorrections ? Object.entries(fieldCorrections).reduce((acc, [key, value]) => {
        acc[key] = { original: null, corrected: value };
        return acc;
      }, {} as Record<string, { original: unknown; corrected: unknown }>) : undefined,
      ledgerCorrections,
      notes,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Approve failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to approve' });
  }
});

// Reject
router.post('/:documentId/reject', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const { fieldCorrections, notes } = req.body;

    const { db } = await import('@ai-accountant/database');
    const queueResult = await db.query(
      `SELECT id FROM review_queue WHERE document_id = $1 AND tenant_id = $2`,
      [documentId, req.user.tenantId]
    );

    if (queueResult.rows.length === 0) {
      res.status(404).json({ error: 'Queue item not found' });
      return;
    }

    const queueId = queueResult.rows[0].id;

    await enhancedReviewQueueManager.completeReview(queueId, req.user.id, 'reject', {
      fieldCorrections,
      notes,
    });

    await feedbackLoopService.processFeedback(req.user.tenantId, {
      documentId,
      reviewerId: req.user.id,
      action: 'reject',
      fieldCorrections: fieldCorrections ? Object.entries(fieldCorrections).reduce((acc, [key, value]) => {
        acc[key] = { original: null, corrected: value };
        return acc;
      }, {} as Record<string, { original: unknown; corrected: unknown }>) : undefined,
      notes,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Reject failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to reject' });
  }
});

// Edit
router.post('/:documentId/edit', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const { fieldCorrections, ledgerCorrections, notes } = req.body;

    const { db } = await import('@ai-accountant/database');
    const queueResult = await db.query(
      `SELECT id FROM review_queue WHERE document_id = $1 AND tenant_id = $2`,
      [documentId, req.user.tenantId]
    );

    if (queueResult.rows.length === 0) {
      res.status(404).json({ error: 'Queue item not found' });
      return;
    }

    const queueId = queueResult.rows[0].id;

    await enhancedReviewQueueManager.completeReview(queueId, req.user.id, 'edit', {
      fieldCorrections,
      ledgerCorrections,
      notes,
    });

    await feedbackLoopService.processFeedback(req.user.tenantId, {
      documentId,
      reviewerId: req.user.id,
      action: 'edit',
      fieldCorrections: fieldCorrections ? Object.entries(fieldCorrections).reduce((acc, [key, value]) => {
        acc[key] = { original: null, corrected: value };
        return acc;
      }, {} as Record<string, { original: unknown; corrected: unknown }>) : undefined,
      ledgerCorrections,
      notes,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Edit failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to edit' });
  }
});

// Autosave
router.post('/:documentId/autosave', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const { fieldEdits, notes } = req.body;

    // Store autosave (would use Redis or similar in production)
    const { db } = await import('@ai-accountant/database');
    await db.query(
      `INSERT INTO review_queue_autosave (document_id, tenant_id, field_edits, notes, saved_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       ON CONFLICT (document_id, tenant_id) DO UPDATE SET
         field_edits = EXCLUDED.field_edits,
         notes = EXCLUDED.notes,
         saved_at = NOW()`,
      [documentId, req.user.tenantId, JSON.stringify(fieldEdits || {}), notes || '']
    );

    res.json({ success: true, savedAt: new Date() });
  } catch (error) {
    logger.error('Autosave failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to autosave' });
  }
});

// Lock status
router.get('/:documentId/lock-status', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const { db } = await import('@ai-accountant/database');
    
    const result = await db.query(
      `SELECT assigned_to, assigned_at FROM review_queue
       WHERE document_id = $1 AND tenant_id = $2 AND status IN ('assigned', 'in_review')`,
      [documentId, req.user.tenantId]
    );

    if (result.rows.length > 0 && result.rows[0].assigned_to !== req.user.id) {
      res.json({ status: 'locked', assignedTo: result.rows[0].assigned_to });
    } else {
      res.json({ status: 'unlocked' });
    }
  } catch (error) {
    logger.error('Lock status check failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to check lock status' });
  }
});

// Backlog stats
router.get('/backlog-stats', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { db } = await import('@ai-accountant/database');
    
    const totalResult = await db.query(
      `SELECT COUNT(*) as count FROM review_queue
       WHERE tenant_id = $1 AND status = 'pending'`,
      [req.user.tenantId]
    );

    const byRiskResult = await db.query(
      `SELECT risk_level, COUNT(*) as count
       FROM review_queue
       WHERE tenant_id = $1 AND status = 'pending'
       GROUP BY risk_level`,
      [req.user.tenantId]
    );

    const avgTimeResult = await db.query(
      `SELECT AVG(time_to_first_review) as avg_time
       FROM review_queue
       WHERE tenant_id = $1 AND time_to_first_review IS NOT NULL`,
      [req.user.tenantId]
    );

    const slaBreachResult = await db.query(
      `SELECT COUNT(*) as count
       FROM review_queue
       WHERE tenant_id = $1 AND status = 'pending' AND sla_deadline < NOW()`,
      [req.user.tenantId]
    );

    const byRiskLevel: Record<string, number> = {};
    for (const row of byRiskResult.rows) {
      byRiskLevel[row.risk_level] = parseInt(row.count, 10);
    }

    res.json({
      total: parseInt(totalResult.rows[0]?.count || '0', 10),
      byRiskLevel,
      avgTimeToFirstReview: Math.floor(parseFloat(avgTimeResult.rows[0]?.avg_time || '0')),
      slaBreaches: parseInt(slaBreachResult.rows[0]?.count || '0', 10),
    });
  } catch (error) {
    logger.error('Backlog stats failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get backlog stats' });
  }
});

export { router as reviewQueueRouter };
