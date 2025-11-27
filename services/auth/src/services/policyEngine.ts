import { randomUUID } from 'crypto';
import { AuthorizationError } from '@ai-accountant/shared-utils';
import {
  AccessAction,
  AccessPolicy,
  ApprovalChain,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRequestStep,
  accessPolicies,
  findApprovalChain,
  findPolicy,
} from '@ai-accountant/shared-types';
import { UserRole } from '@ai-accountant/shared-types';

interface PolicyContext {
  tenantId: string;
  resourceId?: string;
  approvalId?: string;
  actorId: string;
  role: UserRole;
}

const approvalStore = new Map<string, ApprovalRequest>();

function hydrateSteps(chain: ApprovalChain): ApprovalRequestStep[] {
  return chain.steps.map((step) => ({
    ...step,
    status: 'pending',
  }));
}

export function listPolicies(): AccessPolicy[] {
  return accessPolicies;
}

export function listApprovalRequests(tenantId: string): ApprovalRequest[] {
  return Array.from(approvalStore.values()).filter((request) => request.tenantId === tenantId);
}

export function createApprovalRequest(
  action: AccessAction,
  tenantId: string,
  actorId: string,
  resourceId?: string,
  reason?: string
): ApprovalRequest {
  const policy = findPolicy(action);
  if (!policy || !policy.approvalChainId) {
    throw new AuthorizationError('Approval chain not required for this action');
  }

  const chain = findApprovalChain(policy.approvalChainId);
  if (!chain) {
    throw new AuthorizationError('Approval chain not found');
  }

  const now = new Date().toISOString();
  const request: ApprovalRequest = {
    id: randomUUID(),
    chainId: chain.id,
    action,
    tenantId,
    resourceId,
    requestedBy: actorId,
    status: 'pending',
    steps: hydrateSteps(chain),
    createdAt: now,
    updatedAt: now,
    reason,
  };

  approvalStore.set(request.id, request);
  return request;
}

function approvalSatisfied(request: ApprovalRequest): boolean {
  return request.steps.every((step) => step.status === 'approved');
}

export function approveRequest(
  approvalId: string,
  actorId: string,
  role: UserRole,
  decision: ApprovalDecision
): ApprovalRequest {
  const request = approvalStore.get(approvalId);
  if (!request) {
    throw new AuthorizationError('Approval request not found');
  }

  const targetStep = request.steps.find((step) => step.role === role && step.status === 'pending');
  if (!targetStep) {
    throw new AuthorizationError('No matching approval step for this role or already decided');
  }

  if (decision.approved) {
    targetStep.status = 'approved';
    targetStep.approvedBy = actorId;
    targetStep.approvedAt = new Date().toISOString();
    targetStep.note = decision.note;
  } else {
    targetStep.status = 'rejected';
    targetStep.rejectedBy = actorId;
    targetStep.note = decision.note;
    request.status = 'rejected';
  }

  if (approvalSatisfied(request)) {
    request.status = 'approved';
  }

  request.updatedAt = new Date().toISOString();
  approvalStore.set(request.id, request);
  return request;
}

export function evaluatePolicy(action: AccessAction, context: PolicyContext): {
  allowed: boolean;
  policy?: AccessPolicy;
  approvalRequired: boolean;
  approvalSatisfied: boolean;
  approvalId?: string;
} {
  const policy = findPolicy(action);
  if (!policy) {
    throw new AuthorizationError('Policy not configured');
  }

  if (!policy.allowedRoles.includes(context.role)) {
    throw new AuthorizationError('Role not permitted for this action');
  }

  if (!policy.approvalChainId) {
    return {
      allowed: true,
      policy,
      approvalRequired: false,
      approvalSatisfied: true,
    };
  }

  if (!context.approvalId) {
    return {
      allowed: false,
      policy,
      approvalRequired: true,
      approvalSatisfied: false,
    };
  }

  const request = approvalStore.get(context.approvalId);
  if (!request || request.action !== action || request.tenantId !== context.tenantId) {
    throw new AuthorizationError('Approval request is invalid or mismatched');
  }

  return {
    allowed: request.status === 'approved',
    policy,
    approvalRequired: true,
    approvalSatisfied: approvalSatisfied(request),
    approvalId: request.id,
  };
}
