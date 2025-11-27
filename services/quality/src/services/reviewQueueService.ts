import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { DocumentId, TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { dispatchWorkflowTask } from './workflowBridge';

const logger = createLogger('quality-review-queue');

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

type ReviewStatus = 'pending' | 'assigned' | 'in_review' | 'approved' | 'rejected' | 'escalated';

export interface ReviewQueueItem {
  id: string;
  documentId: DocumentId;
  priorityScore: number;
  riskLevel: RiskLevel;
  riskFactors: string[];
  status: ReviewStatus;
  assignedTo?: UserId;
  slaDeadline?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewActionPayload {
  reviewerId: UserId;
  action: 'approve' | 'reject' | 'escalate' | 'retry' | 'resolve';
  notes?: string;
  fieldCorrections?: Record<string, unknown>;
  ledgerCorrections?: Record<string, unknown>;
  taskToken?: string;
}

export interface QueueFilters {
  status?: ReviewStatus;
  riskLevel?: RiskLevel;
}

export async function getReviewQueue(tenantId: TenantId, filters?: QueueFilters): Promise<ReviewQueueItem[]> {
  const params: unknown[] = [tenantId];
  let query = `SELECT id, document_id, priority_score, risk_level, risk_factors, status, assigned_to, sla_deadline, created_at, updated_at
               FROM review_queue WHERE tenant_id = $1`;

  if (filters?.status) {
    params.push(filters.status);
    query += ` AND status = $${params.length}`;
  }

  if (filters?.riskLevel) {
    params.push(filters.riskLevel);
    query += ` AND risk_level = $${params.length}`;
  }

  query += ' ORDER BY priority_score DESC, sla_deadline ASC NULLS LAST';

  const result = await db.query<{
    id: string;
    document_id: DocumentId;
    priority_score: number;
    risk_level: RiskLevel;
    risk_factors: unknown;
    status: ReviewStatus;
    assigned_to: UserId | null;
    sla_deadline: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(query, params);

  return result.rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    priorityScore: Number(row.priority_score),
    riskLevel: row.risk_level,
    riskFactors: (row.risk_factors as string[]) || [],
    status: row.status,
    assignedTo: row.assigned_to || undefined,
    slaDeadline: row.sla_deadline || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function ingestAnomaliesIntoQueue(
  tenantId: TenantId,
  anomalies: Array<{
    documentId: DocumentId;
    priorityScore: number;
    riskLevel: RiskLevel;
    riskFactors: string[];
    slaDeadline?: Date;
  }>
): Promise<number> {
  if (anomalies.length === 0) return 0;

  let inserted = 0;
  for (const anomaly of anomalies) {
    await db.query(
      `INSERT INTO review_queue (
        id, tenant_id, document_id, priority_score, risk_level, risk_factors, status, sla_deadline, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'pending', $7, NOW(), NOW())
      ON CONFLICT (document_id) DO UPDATE SET
        priority_score = EXCLUDED.priority_score,
        risk_level = EXCLUDED.risk_level,
        risk_factors = EXCLUDED.risk_factors,
        sla_deadline = EXCLUDED.sla_deadline,
        status = 'pending',
        updated_at = NOW()`,
      [
        randomUUID(),
        tenantId,
        anomaly.documentId,
        anomaly.priorityScore,
        anomaly.riskLevel,
        JSON.stringify(anomaly.riskFactors),
        anomaly.slaDeadline || null,
      ]
    );
    inserted += 1;
  }

  logger.info('Anomalies ingested into review queue', { tenantId, inserted });
  return inserted;
}

export async function applyBulkAction(
  tenantId: TenantId,
  reviewQueueIds: string[],
  payload: ReviewActionPayload
): Promise<void> {
  await db.transaction(async (client) => {
    const statusMap: Record<ReviewActionPayload['action'], ReviewStatus> = {
      approve: 'approved',
      reject: 'rejected',
      resolve: 'approved',
      retry: 'pending',
      escalate: 'escalated',
    };

    const nextStatus = statusMap[payload.action];
    if (!nextStatus) {
      throw new Error('Unsupported review queue action');
    }
    const placeholders = reviewQueueIds.map((_, idx) => `$${idx + 3}`).join(',');
    await client.query(
      `UPDATE review_queue
       SET status = $1,
           updated_at = NOW(),
           review_completed_at = CASE WHEN $1 IN ('approved','rejected') THEN NOW() ELSE review_completed_at END
       WHERE tenant_id = $2 AND id IN (${placeholders})`,
      [nextStatus, tenantId, ...reviewQueueIds]
    );

    for (const reviewQueueId of reviewQueueIds) {
      await client.query(
        `INSERT INTO reviewer_actions (
          id, review_queue_id, reviewer_id, action_type, field_corrections, ledger_corrections, notes, processing_time_seconds, created_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NULL, NOW())`,
        [
          randomUUID(),
          reviewQueueId,
          payload.reviewerId,
          payload.action,
          JSON.stringify(payload.fieldCorrections || {}),
          JSON.stringify(payload.ledgerCorrections || {}),
          payload.notes || null,
        ]
      );

      if (payload.action === 'retry' || payload.action === 'resolve') {
        await dispatchWorkflowTask(tenantId, reviewQueueId, payload.action, payload.taskToken);
      }
    }
  });

  logger.info('Bulk review action applied', { tenantId, count: reviewQueueIds.length, action: payload.action });
}
