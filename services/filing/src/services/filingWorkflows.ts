import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, FilingId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

const logger = createLogger('filing-workflows');

export type FilingWorkflowStatus =
  | 'draft'
  | 'ready_for_review'
  | 'approved'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'failed'
  | 'amended'
  | 'cancelled';

export interface FilingWorkflow {
  id: string;
  filingId: FilingId;
  tenantId: TenantId;
  status: FilingWorkflowStatus;
  draftGeneratedAt: Date | null;
  readyForReviewAt: Date | null;
  approvedAt: Date | null;
  submittedAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  failedAt: Date | null;
  assignedTo: UserId | null;
  assignedBy: UserId | null;
  supportingDocuments: string[];
  aiExplanation: string | null;
  submissionPayload: Record<string, unknown> | null;
  submissionResponse: Record<string, unknown> | null;
  submissionReceiptId: string | null;
  receiptStorageKey: string | null;
  receiptHash: string | null;
  modelVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filing Workflow Service (Chunk 2)
 * Manages filing lifecycle from draft to submission
 */
export class FilingWorkflowService {
  /**
   * Create workflow for filing
   */
  async createWorkflow(
    filingId: FilingId,
    tenantId: TenantId,
    supportingDocuments: string[] = [],
    aiExplanation?: string
  ): Promise<string> {
    const workflowId = randomUUID();

    await db.query(
      `INSERT INTO filing_workflows (
        id, filing_id, tenant_id, status, draft_generated_at,
        supporting_documents, ai_explanation, created_at, updated_at
      ) VALUES (
        $1, $2, $3, 'draft', NOW(), $4::jsonb, $5, NOW(), NOW()
      )`,
      [
        workflowId,
        filingId,
        tenantId,
        JSON.stringify(supportingDocuments),
        aiExplanation || null,
      ]
    );

    // Log audit trail
    await this.logAuditTrail(filingId, workflowId, 'created', null, 'draft', null, null);

    logger.info('Filing workflow created', { workflowId, filingId });
    return workflowId;
  }

  /**
   * Update workflow status
   */
  async updateStatus(
    workflowId: string,
    status: FilingWorkflowStatus,
    userId: UserId,
    comment?: string
  ): Promise<void> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error('Workflow not found');
    }

    const previousStatus = workflow.status;
    const updateFields: string[] = ['status = $1', 'updated_at = NOW()'];
    const params: unknown[] = [status];

    // Set timestamp based on status
    if (status === 'ready_for_review' && !workflow.readyForReviewAt) {
      updateFields.push('ready_for_review_at = NOW()');
    } else if (status === 'approved' && !workflow.approvedAt) {
      updateFields.push('approved_at = NOW()');
    } else if (status === 'submitted' && !workflow.submittedAt) {
      updateFields.push('submitted_at = NOW()');
    } else if (status === 'accepted' && !workflow.acceptedAt) {
      updateFields.push('accepted_at = NOW()');
    } else if (status === 'rejected' && !workflow.rejectedAt) {
      updateFields.push('rejected_at = NOW()');
    } else if (status === 'failed' && !workflow.failedAt) {
      updateFields.push('failed_at = NOW()');
    }

    params.push(workflowId);

    await db.query(
      `UPDATE filing_workflows
       SET ${updateFields.join(', ')}
       WHERE id = $${params.length}`,
      params
    );

    // Log audit trail
    await this.logAuditTrail(
      workflow.filingId,
      workflowId,
      'status_changed',
      previousStatus,
      status,
      userId,
      comment
    );

    logger.info('Filing workflow status updated', { workflowId, previousStatus, status });
  }

  /**
   * Assign workflow to reviewer
   */
  async assignWorkflow(
    workflowId: string,
    assignedTo: UserId,
    assignedBy: UserId
  ): Promise<void> {
    await db.query(
      `UPDATE filing_workflows
       SET assigned_to = $1, assigned_by = $2, updated_at = NOW()
       WHERE id = $3`,
      [assignedTo, assignedBy, workflowId]
    );

    const workflow = await this.getWorkflow(workflowId);
    if (workflow) {
      await this.logAuditTrail(
        workflow.filingId,
        workflowId,
        'assigned',
        null,
        null,
        assignedBy,
        `Assigned to user ${assignedTo}`
      );
    }
  }

  /**
   * Store submission details
   */
  async recordSubmission(
    workflowId: string,
    submissionPayload: Record<string, unknown>,
    submissionResponse: Record<string, unknown>,
    receiptId?: string
  ): Promise<void> {
    await db.query(
      `UPDATE filing_workflows
       SET submission_payload = $1::jsonb,
           submission_response = $2::jsonb,
           submission_receipt_id = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [
        JSON.stringify(submissionPayload),
        JSON.stringify(submissionResponse),
        receiptId || null,
        workflowId,
      ]
    );
  }

  /**
   * Store receipt with hash verification
   */
  async storeReceipt(
    workflowId: string,
    receiptBuffer: Buffer,
    storageKey: string
  ): Promise<void> {
    const receiptHash = createHash('sha256').update(receiptBuffer).digest('hex');

    await db.query(
      `UPDATE filing_workflows
       SET receipt_storage_key = $1,
           receipt_hash = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [storageKey, receiptHash, workflowId]
    );

    logger.info('Receipt stored', { workflowId, storageKey, receiptHash });
  }

  /**
   * Get workflow by ID
   */
  async getWorkflow(workflowId: string): Promise<FilingWorkflow | null> {
    const result = await db.query<{
      id: string;
      filing_id: string;
      tenant_id: string;
      status: string;
      draft_generated_at: Date | null;
      ready_for_review_at: Date | null;
      approved_at: Date | null;
      submitted_at: Date | null;
      accepted_at: Date | null;
      rejected_at: Date | null;
      failed_at: Date | null;
      assigned_to: string | null;
      assigned_by: string | null;
      supporting_documents: unknown;
      ai_explanation: string | null;
      submission_payload: unknown;
      submission_response: unknown;
      submission_receipt_id: string | null;
      receipt_storage_key: string | null;
      receipt_hash: string | null;
      model_version: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM filing_workflows WHERE id = $1`,
      [workflowId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      filingId: row.filing_id,
      tenantId: row.tenant_id,
      status: row.status as FilingWorkflowStatus,
      draftGeneratedAt: row.draft_generated_at,
      readyForReviewAt: row.ready_for_review_at,
      approvedAt: row.approved_at,
      submittedAt: row.submitted_at,
      acceptedAt: row.accepted_at,
      rejectedAt: row.rejected_at,
      failedAt: row.failed_at,
      assignedTo: row.assigned_to,
      assignedBy: row.assigned_by,
      supportingDocuments: (row.supporting_documents as string[]) || [],
      aiExplanation: row.ai_explanation,
      submissionPayload: (row.submission_payload as Record<string, unknown>) || null,
      submissionResponse: (row.submission_response as Record<string, unknown>) || null,
      submissionReceiptId: row.submission_receipt_id,
      receiptStorageKey: row.receipt_storage_key,
      receiptHash: row.receipt_hash,
      modelVersion: row.model_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get workflow by filing ID
   */
  async getWorkflowByFiling(filingId: FilingId): Promise<FilingWorkflow | null> {
    const result = await db.query<{
      id: string;
      filing_id: string;
      tenant_id: string;
      status: string;
      draft_generated_at: Date | null;
      ready_for_review_at: Date | null;
      approved_at: Date | null;
      submitted_at: Date | null;
      accepted_at: Date | null;
      rejected_at: Date | null;
      failed_at: Date | null;
      assigned_to: string | null;
      assigned_by: string | null;
      supporting_documents: unknown;
      ai_explanation: string | null;
      submission_payload: unknown;
      submission_response: unknown;
      submission_receipt_id: string | null;
      receipt_storage_key: string | null;
      receipt_hash: string | null;
      model_version: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM filing_workflows WHERE filing_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [filingId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      filingId: row.filing_id,
      tenantId: row.tenant_id,
      status: row.status as FilingWorkflowStatus,
      draftGeneratedAt: row.draft_generated_at,
      readyForReviewAt: row.ready_for_review_at,
      approvedAt: row.approved_at,
      submittedAt: row.submitted_at,
      acceptedAt: row.accepted_at,
      rejectedAt: row.rejected_at,
      failedAt: row.failed_at,
      assignedTo: row.assigned_to,
      assignedBy: row.assigned_by,
      supportingDocuments: (row.supporting_documents as string[]) || [],
      aiExplanation: row.ai_explanation,
      submissionPayload: (row.submission_payload as Record<string, unknown>) || null,
      submissionResponse: (row.submission_response as Record<string, unknown>) || null,
      submissionReceiptId: row.submission_receipt_id,
      receiptStorageKey: row.receipt_storage_key,
      receiptHash: row.receipt_hash,
      modelVersion: row.model_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Log audit trail entry
   */
  private async logAuditTrail(
    filingId: FilingId,
    workflowId: string | null,
    action: string,
    previousStatus: string | null,
    newStatus: string | null,
    userId: UserId | null,
    comment?: string
  ): Promise<void> {
    // Get user details if available
    let userName: string | null = null;
    let userEmail: string | null = null;

    if (userId) {
      const userResult = await db.query<{
        name: string | null;
        email: string;
      }>(
        `SELECT name, email FROM users WHERE id = $1`,
        [userId]
      );

      if (userResult.rows.length > 0) {
        userName = userResult.rows[0].name;
        userEmail = userResult.rows[0].email;
      }
    }

    await db.query(
      `INSERT INTO filing_audit_trail (
        id, filing_id, workflow_id, action, previous_status, new_status,
        user_id, user_name, user_email, comment, created_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()
      )`,
      [filingId, workflowId, action, previousStatus, newStatus, userId, userName, userEmail, comment || null]
    );
  }

  /**
   * Get audit trail for filing
   */
  async getAuditTrail(filingId: FilingId): Promise<Array<{
    id: string;
    action: string;
    previousStatus: string | null;
    newStatus: string | null;
    userId: string | null;
    userName: string | null;
    userEmail: string | null;
    comment: string | null;
    createdAt: Date;
  }>> {
    const result = await db.query<{
      id: string;
      action: string;
      previous_status: string | null;
      new_status: string | null;
      user_id: string | null;
      user_name: string | null;
      user_email: string | null;
      comment: string | null;
      created_at: Date;
    }>(
      `SELECT id, action, previous_status, new_status, user_id, user_name, user_email, comment, created_at
       FROM filing_audit_trail
       WHERE filing_id = $1
       ORDER BY created_at ASC`,
      [filingId]
    );

    return result.rows.map(row => ({
      id: row.id,
      action: row.action,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
      userId: row.user_id,
      userName: row.user_name,
      userEmail: row.user_email,
      comment: row.comment,
      createdAt: row.created_at,
    }));
  }
}

export const filingWorkflowService = new FilingWorkflowService();
