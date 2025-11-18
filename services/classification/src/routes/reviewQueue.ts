import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { AuthRequest } from '../middleware/auth';
import {
  enhancedReviewQueueManager,
  RiskLevel,
  ReviewQueueItem,
} from '../services/enhancedReviewQueue';
import { feedbackLoopService } from '../services/feedbackLoop';
import type { FeedbackLoopService } from '../services/feedbackLoop';

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

    const queueOptions: Parameters<typeof enhancedReviewQueueManager.getQueue>[1] = {};

    if (isRiskLevel(riskLevel)) {
      queueOptions.riskLevel = riskLevel;
    }
    if (isReviewStatus(status)) {
      queueOptions.status = status;
    }
    const parsedLimit = typeof limit === 'string' ? Number.parseInt(limit, 10) : undefined;
    if (typeof parsedLimit === 'number' && Number.isFinite(parsedLimit) && parsedLimit > 0) {
      queueOptions.limit = parsedLimit;
    }
    if (typeof reviewerSkill === 'string' && reviewerSkill.trim() !== '') {
      queueOptions.reviewerSkill = reviewerSkill;
    }

    const queue = await enhancedReviewQueueManager.getQueue(req.user.tenantId, queueOptions);

    res.json({ queue });
  } catch (error) {
    logger.error(
      'Get review queue failed',
      error instanceof Error ? error : new Error(String(error))
    );
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
      reviewerSkill: req.user.role,
      limit: 1,
    });

    const item = queue.at(0);
    if (!item) {
      res.json({ document: null });
      return;
    }

    const documentSummary = await fetchDocumentSummary(item.documentId, req.user.tenantId);
    if (!documentSummary) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json({
      sample: {
        id: item.id,
        document: documentSummary,
      },
    });
  } catch (error) {
    logger.error(
      'Get next document failed',
      error instanceof Error ? error : new Error(String(error))
    );
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
    if (!queueId) {
      res.status(400).json({ error: 'queueId is required' });
      return;
    }

    const queueResult = await db.query<{ document_id: string }>(
      `SELECT document_id FROM review_queue WHERE id = $1 AND tenant_id = $2`,
      [queueId, req.user.tenantId]
    );

    const queueItem = queueResult.rows[0];
    if (!queueItem) {
      res.status(404).json({ error: 'Queue item not found' });
      return;
    }

    const documentSummary = await fetchDocumentSummary(queueItem.document_id, req.user.tenantId);
    if (!documentSummary) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.json({ document: documentSummary });
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
    if (!queueId) {
      res.status(400).json({ error: 'queueId is required' });
      return;
    }

    const reviewerId =
      typeof req.body?.reviewerId === 'string' && req.body.reviewerId.trim() !== ''
        ? req.body.reviewerId
        : req.user.id;

    await enhancedReviewQueueManager.assignToReviewer(queueId, reviewerId, req.user.tenantId);

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
    if (!documentId) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }
    const { fieldCorrections, ledgerCorrections, notes } = req.body;

    const queueId = await resolveQueueId(documentId, req.user.tenantId);
    if (!queueId) {
      res.status(404).json({ error: 'Queue item not found' });
      return;
    }

    const fieldCorrectionsRecord = isRecord(fieldCorrections) ? fieldCorrections : undefined;
    const ledgerCorrectionsRecord = isRecord(ledgerCorrections) ? ledgerCorrections : undefined;
    const notesValue = sanitizeNotes(notes);

    const completionPayload: Parameters<typeof enhancedReviewQueueManager.completeReview>[3] = {};
    if (fieldCorrectionsRecord) {
      completionPayload.fieldCorrections = fieldCorrectionsRecord;
    }
    if (ledgerCorrectionsRecord) {
      completionPayload.ledgerCorrections = ledgerCorrectionsRecord;
    }
    if (notesValue) {
      completionPayload.notes = notesValue;
    }

    await enhancedReviewQueueManager.completeReview(
      queueId,
      req.user.id,
      'approve',
      completionPayload
    );

    const feedbackPayload: Parameters<FeedbackLoopService['processFeedback']>[1] = {
      documentId,
      reviewerId: req.user.id,
      action: 'approve',
    };
    const feedbackCorrections = buildFeedbackCorrections(fieldCorrectionsRecord);
    if (feedbackCorrections) {
      feedbackPayload.fieldCorrections = feedbackCorrections;
    }
    if (ledgerCorrectionsRecord) {
      feedbackPayload.ledgerCorrections = ledgerCorrectionsRecord;
    }
    if (notesValue) {
      feedbackPayload.notes = notesValue;
    }

    await feedbackLoopService.processFeedback(req.user.tenantId, feedbackPayload);

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
    if (!documentId) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }
    const { fieldCorrections, notes } = req.body;

    const queueId = await resolveQueueId(documentId, req.user.tenantId);
    if (!queueId) {
      res.status(404).json({ error: 'Queue item not found' });
      return;
    }

    const fieldCorrectionsRecord = isRecord(fieldCorrections) ? fieldCorrections : undefined;
    const notesValue = sanitizeNotes(notes);

    const completionPayload: Parameters<typeof enhancedReviewQueueManager.completeReview>[3] = {};
    if (fieldCorrectionsRecord) {
      completionPayload.fieldCorrections = fieldCorrectionsRecord;
    }
    if (notesValue) {
      completionPayload.notes = notesValue;
    }

    await enhancedReviewQueueManager.completeReview(
      queueId,
      req.user.id,
      'reject',
      completionPayload
    );

    const feedbackPayload: Parameters<FeedbackLoopService['processFeedback']>[1] = {
      documentId,
      reviewerId: req.user.id,
      action: 'reject',
    };
    const feedbackCorrections = buildFeedbackCorrections(fieldCorrectionsRecord);
    if (feedbackCorrections) {
      feedbackPayload.fieldCorrections = feedbackCorrections;
    }
    if (notesValue) {
      feedbackPayload.notes = notesValue;
    }

    await feedbackLoopService.processFeedback(req.user.tenantId, feedbackPayload);

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
    if (!documentId) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }
    const { fieldCorrections, ledgerCorrections, notes } = req.body;

    const queueId = await resolveQueueId(documentId, req.user.tenantId);
    if (!queueId) {
      res.status(404).json({ error: 'Queue item not found' });
      return;
    }

    const fieldCorrectionsRecord = isRecord(fieldCorrections) ? fieldCorrections : undefined;
    const ledgerCorrectionsRecord = isRecord(ledgerCorrections) ? ledgerCorrections : undefined;
    const notesValue = sanitizeNotes(notes);

    const completionPayload: Parameters<typeof enhancedReviewQueueManager.completeReview>[3] = {};
    if (fieldCorrectionsRecord) {
      completionPayload.fieldCorrections = fieldCorrectionsRecord;
    }
    if (ledgerCorrectionsRecord) {
      completionPayload.ledgerCorrections = ledgerCorrectionsRecord;
    }
    if (notesValue) {
      completionPayload.notes = notesValue;
    }

    await enhancedReviewQueueManager.completeReview(
      queueId,
      req.user.id,
      'edit',
      completionPayload
    );

    const feedbackPayload: Parameters<FeedbackLoopService['processFeedback']>[1] = {
      documentId,
      reviewerId: req.user.id,
      action: 'edit',
    };
    const feedbackCorrections = buildFeedbackCorrections(fieldCorrectionsRecord);
    if (feedbackCorrections) {
      feedbackPayload.fieldCorrections = feedbackCorrections;
    }
    if (ledgerCorrectionsRecord) {
      feedbackPayload.ledgerCorrections = ledgerCorrectionsRecord;
    }
    if (notesValue) {
      feedbackPayload.notes = notesValue;
    }

    await feedbackLoopService.processFeedback(req.user.tenantId, feedbackPayload);

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
    if (!documentId) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }
    const { fieldEdits, notes } = req.body;

    const fieldEditsRecord = isRecord(fieldEdits) ? fieldEdits : {};

    await db.query(
      `INSERT INTO review_queue_autosave (document_id, tenant_id, field_edits, notes, saved_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         ON CONFLICT (document_id, tenant_id) DO UPDATE SET
           field_edits = EXCLUDED.field_edits,
           notes = EXCLUDED.notes,
           saved_at = NOW()`,
      [documentId, req.user.tenantId, JSON.stringify(fieldEditsRecord), notes || '']
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
    if (!documentId) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }

    const result = await db.query<{ assigned_to: string | null }>(
      `SELECT assigned_to, assigned_at FROM review_queue
       WHERE document_id = $1 AND tenant_id = $2 AND status IN ('assigned', 'in_review')`,
      [documentId, req.user.tenantId]
    );

    const lockRow = result.rows[0];
    if (lockRow && lockRow.assigned_to && lockRow.assigned_to !== req.user.id) {
      res.json({ status: 'locked', assignedTo: lockRow.assigned_to });
    } else {
      res.json({ status: 'unlocked' });
    }
  } catch (error) {
    logger.error(
      'Lock status check failed',
      error instanceof Error ? error : new Error(String(error))
    );
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

    const totalResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM review_queue
         WHERE tenant_id = $1 AND status = 'pending'`,
      [req.user.tenantId]
    );

    const byRiskResult = await db.query<{ risk_level: string; count: string }>(
      `SELECT risk_level, COUNT(*) as count
         FROM review_queue
         WHERE tenant_id = $1 AND status = 'pending'
         GROUP BY risk_level`,
      [req.user.tenantId]
    );

    const avgTimeResult = await db.query<{ avg_time: string | null }>(
      `SELECT AVG(time_to_first_review) as avg_time
         FROM review_queue
         WHERE tenant_id = $1 AND time_to_first_review IS NOT NULL`,
      [req.user.tenantId]
    );

    const slaBreachResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
         FROM review_queue
         WHERE tenant_id = $1 AND status = 'pending' AND sla_deadline < NOW()`,
      [req.user.tenantId]
    );

    const byRiskLevel: Record<string, number> = {};
    for (const row of byRiskResult.rows) {
      byRiskLevel[row.risk_level] = Number.parseInt(row.count, 10) || 0;
    }

    res.json({
      total: Number.parseInt(totalResult.rows[0]?.count ?? '0', 10) || 0,
      byRiskLevel,
      avgTimeToFirstReview: Math.floor(
        Number.parseFloat(avgTimeResult.rows[0]?.avg_time ?? '0') || 0
      ),
      slaBreaches: Number.parseInt(slaBreachResult.rows[0]?.count ?? '0', 10) || 0,
    });
  } catch (error) {
    logger.error('Backlog stats failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get backlog stats' });
  }
});

type DocumentRow = {
  id: string;
  tenant_id: string;
  file_name: string | null;
  document_type: string | null;
  extracted_data: Record<string, unknown> | null;
  decision_path: string | null;
  features: Record<string, unknown> | null;
  weights: Record<string, unknown> | null;
  accuracy_score: number | string | null;
  completeness_score: number | string | null;
  compliance_risk_score: number | string | null;
  composite_quality_score: number | string | null;
};

const RISK_LEVEL_VALUES: readonly RiskLevel[] = ['low', 'medium', 'high', 'critical'];
const REVIEW_STATUS_VALUES: readonly ReviewQueueItem['status'][] = [
  'pending',
  'assigned',
  'in_review',
  'approved',
  'rejected',
  'escalated',
];

function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === 'string' && (RISK_LEVEL_VALUES as readonly string[]).includes(value);
}

function isReviewStatus(value: unknown): value is ReviewQueueItem['status'] {
  return typeof value === 'string' && (REVIEW_STATUS_VALUES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseNumeric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function sanitizeNotes(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function buildFeedbackCorrections(
  corrections?: Record<string, unknown>
): Record<string, { original: unknown; corrected: unknown }> | undefined {
  if (!corrections) {
    return undefined;
  }
  const entries = Object.entries(corrections);
  if (entries.length === 0) {
    return undefined;
  }
  return entries.reduce<Record<string, { original: unknown; corrected: unknown }>>(
    (acc, [key, value]) => {
      acc[key] = { original: null, corrected: value };
      return acc;
    },
    {}
  );
}

async function resolveQueueId(documentId: string, tenantId: string): Promise<string | null> {
  const queueResult = await db.query<{ id: string }>(
    `SELECT id FROM review_queue WHERE document_id = $1 AND tenant_id = $2`,
    [documentId, tenantId]
  );
  return queueResult.rows[0]?.id ?? null;
}

async function fetchDocumentSummary(
  documentId: string,
  tenantId: string
): Promise<Record<string, unknown> | null> {
  const docResult = await db.query<DocumentRow>(
    `SELECT 
       d.id,
       d.tenant_id,
       d.file_name,
       d.document_type,
       d.extracted_data,
       d.decision_path,
       d.features,
       d.weights,
       qm.accuracy_score,
       qm.completeness_score,
       qm.compliance_risk_score,
       qm.composite_quality_score
     FROM documents d
     LEFT JOIN quality_metrics qm ON qm.document_id = d.id
     WHERE d.id = $1 AND d.tenant_id = $2`,
    [documentId, tenantId]
  );

  const row = docResult.rows[0];
  if (!row) {
    return null;
  }

  const extractedFields = toRecord(row.extracted_data);
  const suggestedLedgerPosting =
    typeof extractedFields.suggestedLedgerPosting === 'string'
      ? extractedFields.suggestedLedgerPosting
      : undefined;

  const reasoningTrace = row.decision_path
    ? {
        decisionPath: row.decision_path,
        features: toRecord(row.features),
        weights: toRecord(row.weights),
      }
    : undefined;

  const qualityMetrics = (() => {
    const accuracyScore = parseNumeric(row.accuracy_score);
    const completenessScore = parseNumeric(row.completeness_score);
    const complianceRiskScore = parseNumeric(row.compliance_risk_score);
    const compositeQualityScore = parseNumeric(row.composite_quality_score);
    const metrics = {
      accuracyScore,
      completenessScore,
      complianceRiskScore,
      compositeQualityScore,
    };
    return Object.values(metrics).some((value) => typeof value === 'number') ? metrics : undefined;
  })();

  return {
    id: row.id,
    fileName: row.file_name ?? '',
    documentType: row.document_type ?? 'unknown',
    extractedFields,
    suggestedLedgerPosting,
    reasoningTrace,
    qualityMetrics,
  };
}

export { router as reviewQueueRouter };
