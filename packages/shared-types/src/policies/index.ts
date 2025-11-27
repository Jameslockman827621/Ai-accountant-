import { UserRole } from '..';

export enum AccessAction {
  MANAGE_USERS = 'manage_users',
  UPDATE_USER_ROLE = 'update_user_role',
  VIEW_AUDIT_LOGS = 'view_audit_logs',
  MANAGE_POLICIES = 'manage_policies',
  APPROVE_CHANGES = 'approve_changes',
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface AccessPolicy {
  id: string;
  action: AccessAction;
  description: string;
  allowedRoles: UserRole[];
  approvalChainId?: string;
  risk: RiskLevel;
  conditions?: Record<string, unknown>;
}

export interface ApprovalStep {
  role: UserRole;
  minimumApprovals?: number;
  note?: string;
}

export interface ApprovalChain {
  id: string;
  name: string;
  description: string;
  steps: ApprovalStep[];
  appliesTo: AccessAction[];
}

export interface ApprovalDecision {
  actorId: string;
  note?: string;
  approved: boolean;
}

export interface ApprovalRequestStep extends ApprovalStep {
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  status: 'pending' | 'approved' | 'rejected';
  note?: string;
}

export interface ApprovalRequest {
  id: string;
  chainId: string;
  action: AccessAction;
  tenantId: string;
  resourceId?: string;
  requestedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  steps: ApprovalRequestStep[];
  createdAt: string;
  updatedAt: string;
  reason?: string;
}

export const approvalChains: ApprovalChain[] = [
  {
    id: 'dual_control',
    name: 'Dual control',
    description: 'Two-person approval for elevated access changes',
    steps: [
      { role: UserRole.ACCOUNTANT, note: 'Peer review of requested change' },
      { role: UserRole.SUPER_ADMIN, note: 'Platform owner sign-off' },
    ],
    appliesTo: [AccessAction.UPDATE_USER_ROLE, AccessAction.MANAGE_POLICIES],
  },
  {
    id: 'audit_review',
    name: 'Audit reviewer',
    description: 'Independent oversight for audit log visibility',
    steps: [{ role: UserRole.AUDITOR, minimumApprovals: 1 }],
    appliesTo: [AccessAction.VIEW_AUDIT_LOGS],
  },
];

export const accessPolicies: AccessPolicy[] = [
  {
    id: 'manage-users',
    action: AccessAction.MANAGE_USERS,
    description: 'Invite or deactivate workspace users',
    allowedRoles: [UserRole.SUPER_ADMIN, UserRole.ACCOUNTANT],
    risk: 'medium',
  },
  {
    id: 'update-user-role',
    action: AccessAction.UPDATE_USER_ROLE,
    description: 'Promote or demote a user role',
    allowedRoles: [UserRole.SUPER_ADMIN, UserRole.ACCOUNTANT],
    approvalChainId: 'dual_control',
    risk: 'high',
  },
  {
    id: 'view-audit',
    action: AccessAction.VIEW_AUDIT_LOGS,
    description: 'Read access and approval logs',
    allowedRoles: [UserRole.SUPER_ADMIN, UserRole.AUDITOR],
    approvalChainId: 'audit_review',
    risk: 'medium',
  },
  {
    id: 'manage-policies',
    action: AccessAction.MANAGE_POLICIES,
    description: 'Change authorization rules and approval flows',
    allowedRoles: [UserRole.SUPER_ADMIN],
    approvalChainId: 'dual_control',
    risk: 'high',
  },
  {
    id: 'approve-changes',
    action: AccessAction.APPROVE_CHANGES,
    description: 'Approve pending privileged actions',
    allowedRoles: [UserRole.SUPER_ADMIN, UserRole.ACCOUNTANT, UserRole.AUDITOR],
    risk: 'medium',
  },
];

export function findPolicy(action: AccessAction): AccessPolicy | undefined {
  return accessPolicies.find((policy) => policy.action === action);
}

export function findApprovalChain(chainId?: string): ApprovalChain | undefined {
  return approvalChains.find((chain) => chain.id === chainId);
}
