import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('workflow-service');

export interface ApprovalLevel {
  level: number;
  approvers: UserId[];
  requiredApprovals: number;
  conditions?: Array<{
    field: string;
    operator: string;
    value: unknown;
  }>;
}

export interface MultiLevelApproval {
  id: string;
  tenantId: TenantId;
  entityType: 'document' | 'filing' | 'ledger_entry';
  entityId: string;
  levels: ApprovalLevel[];
  currentLevel: number;
  status: 'pending' | 'approved' | 'rejected';
  approvals: Array<{
    level: number;
    approverId: UserId;
    approved: boolean;
    comment?: string;
    approvedAt: Date;
  }>;
}

/**
 * Create multi-level approval workflow
 */
export async function createMultiLevelApproval(
  tenantId: TenantId,
  entityType: MultiLevelApproval['entityType'],
  entityId: string,
  levels: ApprovalLevel[]
): Promise<string> {
  const approvalId = crypto.randomUUID();

  await db.query(
    `INSERT INTO multi_level_approvals (
      id, tenant_id, entity_type, entity_id, levels, current_level, status, approvals, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5::jsonb, 1, 'pending', '[]'::jsonb, NOW(), NOW())`,
    [approvalId, tenantId, entityType, entityId, JSON.stringify(levels)]
  );

  logger.info('Multi-level approval created', { approvalId, tenantId, levels: levels.length });
  return approvalId;
}

/**
 * Approve at current level
 */
export async function approveAtLevel(
  approvalId: string,
  approverId: UserId,
  comment?: string
): Promise<boolean> {
  const approval = await getApproval(approvalId);
  if (!approval) {
    throw new Error('Approval not found');
  }

  const currentLevel = approval.levels[approval.currentLevel - 1];
  if (!currentLevel.approvers.includes(approverId)) {
    throw new Error('User is not an approver for this level');
  }

  // Check if already approved
  const existingApproval = approval.approvals.find(
    a => a.level === approval.currentLevel && a.approverId === approverId
  );
  if (existingApproval) {
    throw new Error('Already approved at this level');
  }

  // Add approval
  const newApproval = {
    level: approval.currentLevel,
    approverId,
    approved: true,
    comment,
    approvedAt: new Date(),
  };

  const updatedApprovals = [...approval.approvals, newApproval];
  const levelApprovals = updatedApprovals.filter(a => a.level === approval.currentLevel && a.approved);
  const hasRequiredApprovals = levelApprovals.length >= currentLevel.requiredApprovals;

  let newStatus: 'pending' | 'approved' | 'rejected' = 'pending';
  let newLevel = approval.currentLevel;

  if (hasRequiredApprovals) {
    if (approval.currentLevel >= approval.levels.length) {
      newStatus = 'approved';
    } else {
      newLevel = approval.currentLevel + 1;
    }
  }

  await db.query(
    `UPDATE multi_level_approvals
     SET approvals = $1::jsonb,
         current_level = $2,
         status = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [JSON.stringify(updatedApprovals), newLevel, newStatus, approvalId]
  );

  logger.info('Approval recorded', { approvalId, level: approval.currentLevel, approverId });
  return newStatus === 'approved';
}

/**
 * Reject approval
 */
export async function rejectApproval(
  approvalId: string,
  approverId: UserId,
  reason: string
): Promise<void> {
  const approval = await getApproval(approvalId);
  if (!approval) {
    throw new Error('Approval not found');
  }

  const newApproval = {
    level: approval.currentLevel,
    approverId,
    approved: false,
    comment: reason,
    approvedAt: new Date(),
  };

  const updatedApprovals = [...approval.approvals, newApproval];

  await db.query(
    `UPDATE multi_level_approvals
     SET approvals = $1::jsonb,
         status = 'rejected',
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(updatedApprovals), approvalId]
  );

  logger.info('Approval rejected', { approvalId, approverId, reason });
}

async function getApproval(approvalId: string): Promise<MultiLevelApproval | null> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    entity_type: string;
    entity_id: string;
    levels: unknown;
    current_level: number;
    status: string;
    approvals: unknown;
  }>(
    'SELECT * FROM multi_level_approvals WHERE id = $1',
    [approvalId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    entityType: row.entity_type as MultiLevelApproval['entityType'],
    entityId: row.entity_id,
    levels: row.levels as ApprovalLevel[],
    currentLevel: row.current_level,
    status: row.status as MultiLevelApproval['status'],
    approvals: row.approvals as MultiLevelApproval['approvals'],
  };
}
