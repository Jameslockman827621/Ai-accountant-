import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId, UserId } from '@ai-accountant/shared-types';
import { MIN_CONFIDENCE_THRESHOLD } from '@ai-accountant/validation-service/services/confidenceThreshold';

const logger = createLogger('classification-service');

export interface ReviewQueueItem {
  documentId: DocumentId;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  reason: string;
  confidenceScore: number;
  qualityScore: number | null;
  createdAt: Date;
  assignedTo?: UserId;
}

/**
 * Route documents to review queue based on confidence and quality thresholds
 */
export async function routeToReviewQueue(
  tenantId: TenantId,
  documentId: DocumentId
): Promise<boolean> {
  logger.info('Routing document to review queue', { tenantId, documentId });

  // Get document details
  const docResult = await db.query<{
    id: string;
    confidence_score: number | null;
    quality_score: number | null;
    status: string;
    extracted_data: Record<string, unknown> | null;
  }>(
    `SELECT id, confidence_score, quality_score, status, extracted_data
     FROM documents
     WHERE id = $1 AND tenant_id = $2`,
    [documentId, tenantId]
  );

  if (docResult.rows.length === 0) {
    throw new Error('Document not found');
  }

  const document = docResult.rows[0];
  const confidenceScore = document.confidence_score || 0;
  const qualityScore = document.quality_score || 100;

  // Determine if needs review
  const needsReview =
    confidenceScore < MIN_CONFIDENCE_THRESHOLD ||
    qualityScore < 70 ||
    document.status === 'error';

  if (!needsReview) {
    return false;
  }

  // Determine priority
  let priority: ReviewQueueItem['priority'] = 'medium';
  let reason = '';

  if (confidenceScore < 0.5 || qualityScore < 50) {
    priority = 'urgent';
    reason = 'Very low confidence or quality score';
  } else if (confidenceScore < MIN_CONFIDENCE_THRESHOLD) {
    priority = 'high';
    reason = `Confidence below threshold: ${(confidenceScore * 100).toFixed(1)}%`;
  } else if (qualityScore < 70) {
    priority = 'high';
    reason = `Quality score below threshold: ${qualityScore}`;
  } else if (document.status === 'error') {
    priority = 'high';
    reason = 'Document processing error';
  }

  // Check if already in review queue
  const existingResult = await db.query<{
    id: string;
  }>(
    `SELECT id
     FROM document_review_queue
     WHERE document_id = $1 AND tenant_id = $2 AND status = 'pending'`,
    [documentId, tenantId]
  );

  if (existingResult.rows.length > 0) {
    // Update existing queue item
    await db.query(
      `UPDATE document_review_queue
       SET priority = $1,
           reason = $2,
           updated_at = NOW()
       WHERE document_id = $3 AND tenant_id = $4`,
      [priority, reason, documentId, tenantId]
    );
  } else {
    // Create new queue item
    await db.query(
      `INSERT INTO document_review_queue (
        id, tenant_id, document_id, priority, reason, status, created_at, updated_at
      ) VALUES (gen_random_uuid(), $1, $2, $3, $4, 'pending', NOW(), NOW())`,
      [tenantId, documentId, priority, reason]
    );
  }

  // Update document status
  await db.query(
    `UPDATE documents
     SET status = 'pending_review', updated_at = NOW()
     WHERE id = $1`,
    [documentId]
  );

  logger.info('Document routed to review queue', { documentId, priority, reason });

  return true;
}

/**
 * Get review queue for a tenant
 */
export async function getReviewQueue(
  tenantId: TenantId,
  priority?: ReviewQueueItem['priority'],
  limit = 50
): Promise<ReviewQueueItem[]> {
  let query = `SELECT 
     dq.document_id,
     dq.priority,
     dq.reason,
     d.confidence_score,
     d.quality_score,
     dq.created_at,
     dq.assigned_to
   FROM document_review_queue dq
   JOIN documents d ON dq.document_id = d.id
   WHERE dq.tenant_id = $1 AND dq.status = 'pending'`;

  const params: unknown[] = [tenantId];

  if (priority) {
    query += ' AND dq.priority = $2';
    params.push(priority);
    query += ' ORDER BY CASE dq.priority WHEN \'urgent\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 ELSE 4 END, dq.created_at ASC';
  } else {
    query += ' ORDER BY CASE dq.priority WHEN \'urgent\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 ELSE 4 END, dq.created_at ASC';
  }

  query += ` LIMIT $${params.length + 1}`;
  params.push(limit);

  const result = await db.query<{
    document_id: string;
    priority: string;
    reason: string;
    confidence_score: number | null;
    quality_score: number | null;
    created_at: Date;
    assigned_to: string | null;
  }>(query, params);

  return result.rows.map(row => ({
    documentId: row.document_id as DocumentId,
    priority: row.priority as ReviewQueueItem['priority'],
    reason: row.reason,
    confidenceScore: row.confidence_score || 0,
    qualityScore: row.quality_score || null,
    createdAt: row.created_at,
    assignedTo: row.assigned_to as UserId | undefined,
  }));
}

/**
 * Assign review queue item to user
 */
export async function assignReviewItem(
  tenantId: TenantId,
  documentId: DocumentId,
  userId: UserId
): Promise<void> {
  await db.query(
    `UPDATE document_review_queue
     SET assigned_to = $1, updated_at = NOW()
     WHERE document_id = $2 AND tenant_id = $3 AND status = 'pending'`,
    [userId, documentId, tenantId]
  );

  logger.info('Review item assigned', { documentId, userId });
}

/**
 * Mark review item as completed
 */
export async function completeReviewItem(
  tenantId: TenantId,
  documentId: DocumentId,
  approved: boolean,
  notes?: string
): Promise<void> {
  await db.query(
    `UPDATE document_review_queue
     SET status = $1,
         review_notes = $2,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE document_id = $3 AND tenant_id = $4`,
    [approved ? 'approved' : 'rejected', notes || null, documentId, tenantId]
  );

  // Update document status
  const newStatus = approved ? 'classified' : 'error';
  await db.query(
    `UPDATE documents
     SET status = $1, updated_at = NOW()
     WHERE id = $2`,
    [newStatus, documentId]
  );

  logger.info('Review item completed', { documentId, approved });
}
