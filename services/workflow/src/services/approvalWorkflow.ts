import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('workflow-service');

export interface ApprovalWorkflow {
  id: string;
  tenantId: TenantId;
  entityType: 'filing' | 'ledger_entry' | 'document';
  entityId: string;
  status: 'pending' | 'approved' | 'rejected';
  approvers: Array<{
    userId: UserId;
    status: 'pending' | 'approved' | 'rejected';
    approvedAt: Date | null;
    comment: string | null;
  }>;
  requiredApprovals: number;
  currentApprovals: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function createApprovalWorkflow(
  tenantId: TenantId,
  entityType: ApprovalWorkflow['entityType'],
  entityId: string,
  approverIds: UserId[],
  requiredApprovals: number = 1
): Promise<string> {
  const workflowId = crypto.randomUUID();

  const approvers = approverIds.map(userId => ({
    userId,
    status: 'pending' as const,
    approvedAt: null,
    comment: null,
  }));

  await db.query(
    `INSERT INTO approval_workflows (
      id, tenant_id, entity_type, entity_id, status, approvers, required_approvals, current_approvals, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, $6, 0, NOW(), NOW())`,
    [workflowId, tenantId, entityType, entityId, JSON.stringify(approvers), requiredApprovals]
  );

  logger.info('Approval workflow created', {
    workflowId,
    tenantId,
    entityType,
    entityId,
    requiredApprovals,
  });

  return workflowId;
}

export async function approveWorkflow(
  workflowId: string,
  userId: UserId,
  comment?: string
): Promise<boolean> {
  const workflow = await getApprovalWorkflow(workflowId);
  if (!workflow) {
    throw new Error('Approval workflow not found');
  }

  // Find approver
  const approver = workflow.approvers.find(a => a.userId === userId);
  if (!approver) {
    throw new Error('User is not an approver for this workflow');
  }

  if (approver.status !== 'pending') {
    throw new Error('Approver has already responded');
  }

  // Update approver status
  approver.status = 'approved';
  approver.approvedAt = new Date();
  approver.comment = comment || null;

  const newApprovals = workflow.currentApprovals + 1;
  const newStatus = newApprovals >= workflow.requiredApprovals ? 'approved' : 'pending';

  await db.query(
    `UPDATE approval_workflows
     SET approvers = $1::jsonb,
         current_approvals = $2,
         status = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [JSON.stringify(workflow.approvers), newApprovals, newStatus, workflowId]
  );

  logger.info('Workflow approved', {
    workflowId,
    userId,
    currentApprovals: newApprovals,
    requiredApprovals: workflow.requiredApprovals,
  });

  return newStatus === 'approved';
}

export async function rejectWorkflow(
  workflowId: string,
  userId: UserId,
  reason: string
): Promise<void> {
  const workflow = await getApprovalWorkflow(workflowId);
  if (!workflow) {
    throw new Error('Approval workflow not found');
  }

  const approver = workflow.approvers.find(a => a.userId === userId);
  if (!approver) {
    throw new Error('User is not an approver for this workflow');
  }

  approver.status = 'rejected';
  approver.approvedAt = new Date();
  approver.comment = reason;

  await db.query(
    `UPDATE approval_workflows
     SET approvers = $1::jsonb,
         status = 'rejected',
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(workflow.approvers), workflowId]
  );

  logger.info('Workflow rejected', { workflowId, userId, reason });
}

export async function getApprovalWorkflow(workflowId: string): Promise<ApprovalWorkflow | null> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    entity_type: string;
    entity_id: string;
    status: string;
    approvers: unknown;
    required_approvals: number;
    current_approvals: number;
    created_at: Date;
    updated_at: Date;
  }>(
    'SELECT * FROM approval_workflows WHERE id = $1',
    [workflowId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    entityType: row.entity_type as ApprovalWorkflow['entityType'],
    entityId: row.entity_id,
    status: row.status as ApprovalWorkflow['status'],
    approvers: (row.approvers as ApprovalWorkflow['approvers']) || [],
    requiredApprovals: row.required_approvals,
    currentApprovals: row.current_approvals,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getPendingApprovals(
  tenantId: TenantId,
  userId: UserId
): Promise<ApprovalWorkflow[]> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    entity_type: string;
    entity_id: string;
    status: string;
    approvers: unknown;
    required_approvals: number;
    current_approvals: number;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT * FROM approval_workflows
     WHERE tenant_id = $1
       AND status = 'pending'
       AND approvers::jsonb @> $2::jsonb
     ORDER BY created_at ASC`,
    [tenantId, JSON.stringify([{ userId, status: 'pending' }])]
  );

  return result.rows.map(row => ({
    id: row.id,
    tenantId: row.tenant_id,
    entityType: row.entity_type as ApprovalWorkflow['entityType'],
    entityId: row.entity_id,
    status: row.status as ApprovalWorkflow['status'],
    approvers: (row.approvers as ApprovalWorkflow['approvers']) || [],
    requiredApprovals: row.required_approvals,
    currentApprovals: row.current_approvals,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
