import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('review-assignments');

export interface ReviewAssignment {
  id: string;
  documentId: DocumentId;
  tenantId: TenantId;
  assignedTo: UserId;
  assignedBy: UserId | null;
  assignmentReason: string | null;
  assignedAt: Date;
  dueAt: Date | null;
  completedAt: Date | null;
  overdue: boolean;
  status: 'assigned' | 'in_progress' | 'completed' | 'escalated';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  escalatedAt: Date | null;
  escalatedTo: UserId | null;
  escalationReason: string | null;
}

/**
 * Review Assignment Service (Chunk 4)
 * Manages document review assignments with SLA tracking
 */
export class ReviewAssignmentService {
  /**
   * Assign document to reviewer
   */
  async assignDocument(
    documentId: DocumentId,
    tenantId: TenantId,
    assignedTo: UserId,
    assignedBy: UserId,
    priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal',
    reason?: string
  ): Promise<string> {
    // Calculate due date based on priority
    const dueAt = this.calculateDueDate(priority);

    const result = await db.query<{ id: string }>(
      `INSERT INTO review_assignments (
        id, document_id, tenant_id, assigned_to, assigned_by,
        assignment_reason, assigned_at, due_at, status, priority,
        overdue, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, NOW(), $6, 'assigned', $7, false, NOW(), NOW()
      ) RETURNING id`,
      [documentId, tenantId, assignedTo, assignedBy, reason || null, dueAt, priority]
    );

    logger.info('Document assigned for review', {
      documentId,
      assignedTo,
      priority,
      dueAt,
    });

    return result.rows[0].id;
  }

  /**
   * Auto-assign document based on workload balancing
   */
  async autoAssignDocument(
    documentId: DocumentId,
    tenantId: TenantId,
    priority: 'low' | 'normal' | 'high' | 'urgent' = 'normal'
  ): Promise<string | null> {
    // Get available reviewers for tenant
    const reviewers = await this.getAvailableReviewers(tenantId);

    if (reviewers.length === 0) {
      logger.warn('No available reviewers found', { tenantId });
      return null;
    }

    // Select reviewer with least workload
    const selectedReviewer = reviewers.reduce((min, reviewer) =>
      reviewer.pendingCount < min.pendingCount ? reviewer : min
    );

    return this.assignDocument(
      documentId,
      tenantId,
      selectedReviewer.userId,
      'system' as UserId,
      priority,
      'Auto-assigned based on workload'
    );
  }

  /**
   * Get available reviewers with workload
   */
  private async getAvailableReviewers(tenantId: TenantId): Promise<Array<{
    userId: UserId;
    pendingCount: number;
  }>> {
    const result = await db.query<{
      user_id: string;
      pending_count: string;
    }>(
      `SELECT 
        u.id as user_id,
        COUNT(ra.id) as pending_count
      FROM users u
      LEFT JOIN review_assignments ra ON ra.assigned_to = u.id
        AND ra.status IN ('assigned', 'in_progress')
        AND ra.tenant_id = $1
      WHERE u.tenant_id = $1
        AND u.role IN ('reviewer', 'admin', 'accountant')
      GROUP BY u.id
      ORDER BY pending_count ASC`,
      [tenantId]
    );

    return result.rows.map(row => ({
      userId: row.user_id,
      pendingCount: parseInt(row.pending_count, 10),
    }));
  }

  /**
   * Calculate due date based on priority
   */
  private calculateDueDate(priority: 'low' | 'normal' | 'high' | 'urgent'): Date {
    const now = new Date();
    const hours = {
      low: 72, // 3 days
      normal: 24, // 1 day
      high: 8, // 8 hours
      urgent: 2, // 2 hours
    };

    now.setHours(now.getHours() + hours[priority]);
    return now;
  }

  /**
   * Update assignment status
   */
  async updateStatus(
    assignmentId: string,
    status: ReviewAssignment['status'],
    userId: UserId
  ): Promise<void> {
    await db.query(
      `UPDATE review_assignments
       SET status = $1,
           ${status === 'completed' ? 'completed_at = NOW(),' : ''}
           updated_at = NOW()
       WHERE id = $2 AND assigned_to = $3`,
      [status, assignmentId, userId]
    );
  }

  /**
   * Get assignments for reviewer
   */
  async getReviewerAssignments(
    userId: UserId,
    tenantId: TenantId,
    status?: ReviewAssignment['status']
  ): Promise<ReviewAssignment[]> {
    let query = `SELECT * FROM review_assignments
                 WHERE assigned_to = $1 AND tenant_id = $2`;
    const params: unknown[] = [userId, tenantId];

    if (status) {
      query += ' AND status = $3';
      params.push(status);
    }

    query += ' ORDER BY due_at ASC, priority DESC';

    const result = await db.query<{
      id: string;
      document_id: string;
      tenant_id: string;
      assigned_to: string;
      assigned_by: string | null;
      assignment_reason: string | null;
      assigned_at: Date;
      due_at: Date | null;
      completed_at: Date | null;
      overdue: boolean;
      status: string;
      priority: string;
      escalated_at: Date | null;
      escalated_to: string | null;
      escalation_reason: string | null;
    }>(query, params);

    return result.rows.map(row => ({
      id: row.id,
      documentId: row.document_id,
      tenantId: row.tenant_id,
      assignedTo: row.assigned_to,
      assignedBy: row.assigned_by,
      assignmentReason: row.assignment_reason,
      assignedAt: row.assigned_at,
      dueAt: row.due_at,
      completedAt: row.completed_at,
      overdue: row.overdue,
      status: row.status as ReviewAssignment['status'],
      priority: row.priority as ReviewAssignment['priority'],
      escalatedAt: row.escalated_at,
      escalatedTo: row.escalated_to,
      escalatedTo: row.escalated_to,
      escalationReason: row.escalation_reason,
    }));
  }

  /**
   * Check and update overdue assignments
   */
  async updateOverdueAssignments(): Promise<number> {
    const result = await db.query(
      `UPDATE review_assignments
       SET overdue = true, updated_at = NOW()
       WHERE status IN ('assigned', 'in_progress')
         AND due_at IS NOT NULL
         AND due_at < NOW()
         AND overdue = false
       RETURNING id`
    );

    logger.info('Updated overdue assignments', { count: result.rowCount });
    return result.rowCount || 0;
  }

  /**
   * Escalate assignment
   */
  async escalateAssignment(
    assignmentId: string,
    escalatedTo: UserId,
    reason: string
  ): Promise<void> {
    await db.query(
      `UPDATE review_assignments
       SET status = 'escalated',
           escalated_at = NOW(),
           escalated_to = $1,
           escalation_reason = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [escalatedTo, reason, assignmentId]
    );
  }
}

export const reviewAssignmentService = new ReviewAssignmentService();

// Background job to update overdue assignments (run every hour)
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    reviewAssignmentService.updateOverdueAssignments().catch(error => {
      logger.error('Failed to update overdue assignments', error instanceof Error ? error : new Error(String(error)));
    });
  }, 60 * 60 * 1000); // 1 hour
}
