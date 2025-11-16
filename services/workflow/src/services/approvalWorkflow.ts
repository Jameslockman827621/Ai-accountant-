import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { randomUUID } from 'crypto';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('approval-workflow');

export type ApprovalPolicy = 'auto' | 'accountant_review' | 'client_signoff' | 'multi_level';

export interface ApprovalStep {
  stepNumber: number;
  approverRole: string;
  approverId?: string;
  status: 'pending' | 'approved' | 'rejected' | 'delegated';
  required: boolean;
  comments?: string;
  signedAt?: string;
  signatureHash?: string;
}

export interface ApprovalWorkflow {
  id: string;
  tenantId: string;
  filingId?: string;
  workflowType: string;
  policyType: ApprovalPolicy;
  status: 'pending' | 'in_progress' | 'approved' | 'rejected' | 'expired';
  steps: ApprovalStep[];
  currentStep: number;
  createdAt: string;
  completedAt?: string;
  expiresAt?: string;
}

export class ApprovalWorkflowService {
  /**
   * Create approval workflow
   */
  async createWorkflow(
    tenantId: TenantId,
    filingId: string | null,
    workflowType: string,
    policyType: ApprovalPolicy,
    steps: Omit<ApprovalStep, 'status' | 'signedAt' | 'signatureHash'>[],
    expiresInHours: number = 48
  ): Promise<string> {
    const workflowId = randomUUID();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiresInHours);

    await db.query(
      `INSERT INTO approval_workflows (
        id, tenant_id, filing_id, workflow_type, policy_type,
        status, steps, current_step, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        workflowId,
        tenantId,
        filingId,
        workflowType,
        policyType,
        'pending',
        JSON.stringify(steps.map(s => ({ ...s, status: 'pending' as const }))),
        1,
        expiresAt,
      ]
    );

    // Auto-approve if policy is 'auto'
    if (policyType === 'auto') {
      await this.autoApprove(workflowId);
    }

    return workflowId;
  }

  /**
   * Approve step
   */
  async approveStep(
    workflowId: string,
    stepNumber: number,
    approverId: UserId,
    comments?: string,
    signatureHash?: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error('Workflow not found');
    }

    if (workflow.status !== 'pending' && workflow.status !== 'in_progress') {
      throw new Error('Workflow is not in a state that can be approved');
    }

    const step = workflow.steps.find(s => s.stepNumber === stepNumber);
    if (!step) {
      throw new Error('Step not found');
    }

    if (step.status === 'approved') {
      throw new Error('Step already approved');
    }

    // Update step status
    const updatedSteps = workflow.steps.map(s =>
      s.stepNumber === stepNumber
        ? {
            ...s,
            status: 'approved' as const,
            comments,
            signedAt: new Date().toISOString(),
            signatureHash,
          }
        : s
    );

    // Record in history
    await db.query(
      `INSERT INTO approval_history (
        workflow_id, step_number, action, approver_id, approver_role,
        comments, signature_hash, ip_address, user_agent, immutable_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        workflowId,
        stepNumber,
        'approve',
        approverId,
        step.approverRole,
        comments,
        signatureHash,
        ipAddress,
        userAgent,
        await this.hashHistoryEntry(workflowId, stepNumber, 'approve', approverId),
      ]
    );

    // Check if all required steps are approved
    const allRequiredApproved = updatedSteps
      .filter(s => s.required)
      .every(s => s.status === 'approved');

    if (allRequiredApproved) {
      // Workflow complete
      await db.query(
        `UPDATE approval_workflows
         SET status = 'approved',
             steps = $1::jsonb,
             current_step = $2,
             completed_at = NOW()
         WHERE id = $3`,
        [JSON.stringify(updatedSteps), stepNumber + 1, workflowId]
      );

      // Update filing status if applicable
      if (workflow.filingId) {
        await db.query(
          `UPDATE filing_ledger
           SET status = 'approved',
               approved_at = NOW(),
               approved_by = $1,
               approval_workflow_id = $2
           WHERE id = $3`,
          [approverId, workflowId, workflow.filingId]
        );
      }
    } else {
      // Move to next step
      const nextStep = updatedSteps.find(s => s.stepNumber > stepNumber && s.status === 'pending');
      
      await db.query(
        `UPDATE approval_workflows
         SET status = 'in_progress',
             steps = $1::jsonb,
             current_step = $2
         WHERE id = $3`,
        [
          JSON.stringify(updatedSteps),
          nextStep ? nextStep.stepNumber : stepNumber + 1,
          workflowId,
        ]
      );
    }
  }

  /**
   * Reject workflow
   */
  async rejectStep(
    workflowId: string,
    stepNumber: number,
    approverId: UserId,
    reason: string,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error('Workflow not found');
    }

    const step = workflow.steps.find(s => s.stepNumber === stepNumber);
    if (!step) {
      throw new Error('Step not found');
    }

    const updatedSteps = workflow.steps.map(s =>
      s.stepNumber === stepNumber
        ? { ...s, status: 'rejected' as const, comments: reason }
        : s
    );

    await db.query(
      `INSERT INTO approval_history (
        workflow_id, step_number, action, approver_id, approver_role,
        comments, immutable_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        workflowId,
        stepNumber,
        'reject',
        approverId,
        step.approverRole,
        reason,
        await this.hashHistoryEntry(workflowId, stepNumber, 'reject', approverId),
      ]
    );

    await db.query(
      `UPDATE approval_workflows
       SET status = 'rejected',
           steps = $1::jsonb,
           completed_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(updatedSteps), workflowId]
    );

    // Update filing status if applicable
    if (workflow.filingId) {
      await db.query(
        `UPDATE filing_ledger
         SET status = 'rejected'
         WHERE id = $1`,
        [workflow.filingId]
      );
    }
  }

  /**
   * Get workflow
   */
  async getWorkflow(workflowId: string): Promise<ApprovalWorkflow | null> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      filing_id: string | null;
      workflow_type: string;
      policy_type: string;
      status: string;
      steps: unknown;
      current_step: number;
      created_at: string;
      completed_at: string | null;
      expires_at: string | null;
    }>(
      `SELECT id, tenant_id, filing_id, workflow_type, policy_type,
              status, steps, current_step, created_at, completed_at, expires_at
       FROM approval_workflows
       WHERE id = $1`,
      [workflowId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id,
      filingId: row.filing_id || undefined,
      workflowType: row.workflow_type,
      policyType: row.policy_type as ApprovalPolicy,
      status: row.status as ApprovalWorkflow['status'],
      steps: row.steps as ApprovalStep[],
      currentStep: row.current_step,
      createdAt: row.created_at,
      completedAt: row.completed_at || undefined,
      expiresAt: row.expires_at || undefined,
    };
  }

  /**
   * Get workflow history
   */
  async getWorkflowHistory(workflowId: string): Promise<Array<{
    stepNumber: number;
    action: string;
    approverId: string;
    approverRole: string;
    comments: string | null;
    signedAt: string;
  }>> {
    const result = await db.query<{
      step_number: number;
      action: string;
      approver_id: string;
      approver_role: string | null;
      comments: string | null;
      created_at: string;
    }>(
      `SELECT step_number, action, approver_id, approver_role, comments, created_at
       FROM approval_history
       WHERE workflow_id = $1
       ORDER BY step_number, created_at`,
      [workflowId]
    );

    return result.rows.map(row => ({
      stepNumber: row.step_number,
      action: row.action,
      approverId: row.approver_id,
      approverRole: row.approver_role || 'unknown',
      comments: row.comments || null,
      signedAt: row.created_at,
    }));
  }

  /**
   * Check for expired workflows and escalate
   */
  async checkExpiredWorkflows(): Promise<void> {
    const expiredResult = await db.query<{ id: string; filing_id: string | null }>(
      `SELECT id, filing_id
       FROM approval_workflows
       WHERE status IN ('pending', 'in_progress')
         AND expires_at < NOW()`,
      []
    );

    for (const workflow of expiredResult.rows) {
      await db.query(
        `UPDATE approval_workflows
         SET status = 'expired'
         WHERE id = $1`,
        [workflow.id]
      );

      // Escalate (would send notifications)
      logger.warn('Workflow expired', { workflowId: workflow.id, filingId: workflow.filing_id });
    }
  }

  private async autoApprove(workflowId: string): Promise<void> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) return;

    // Auto-approve all steps
    for (const step of workflow.steps) {
      await this.approveStep(
        workflowId,
        step.stepNumber,
        'system' as UserId,
        'Auto-approved based on policy'
      );
    }
  }

  private async hashHistoryEntry(
    workflowId: string,
    stepNumber: number,
    action: string,
    approverId: string
  ): Promise<string> {
    const data = `${workflowId}-${stepNumber}-${action}-${approverId}-${Date.now()}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

export const approvalWorkflowService = new ApprovalWorkflowService();
