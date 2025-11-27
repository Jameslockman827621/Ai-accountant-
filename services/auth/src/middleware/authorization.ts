import { NextFunction, Response } from 'express';
import { AuthenticationError, AuthorizationError } from '@ai-accountant/shared-utils';
import { AccessAction } from '@ai-accountant/shared-types';
import { AuthRequest } from './auth';
import { evaluatePolicy } from '../services/policyEngine';
import { recordAccessLog } from '../services/auditLog';
import { createDataMutationTrace } from '@ai-accountant/observability';

interface AuthorizeOptions {
  resourceResolver?: (req: AuthRequest) => string | undefined;
  traceEntity?: string;
}

export function authorizeAction(action: AccessAction, options?: AuthorizeOptions) {
  return (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AuthenticationError('Authentication required');
    }

    const approvalId = req.headers['x-approval-id'] as string | undefined;
    const resourceId = options?.resourceResolver?.(req);

    const evaluation = evaluatePolicy(action, {
      tenantId: req.user.tenantId,
      resourceId,
      approvalId,
      actorId: req.user.userId,
      role: req.user.role,
    });

    recordAccessLog({
      tenantId: req.user.tenantId,
      actorId: req.user.userId,
      action,
      resource: resourceId,
      status: evaluation.allowed ? 'allowed' : 'denied',
      message: evaluation.approvalRequired && !evaluation.approvalSatisfied
        ? 'Approval pending'
        : evaluation.allowed
          ? 'Policy check passed'
          : 'Policy check failed',
    });

    if (!evaluation.allowed) {
      throw new AuthorizationError('Access denied by policy');
    }

    if (options?.traceEntity && resourceId) {
      const trace = createDataMutationTrace({
        entity: options.traceEntity,
        entityId: resourceId,
        tenantId: req.user.tenantId,
        actorId: req.user.userId,
        operation: 'access',
        metadata: { action },
      });
      req.headers['x-trace-id'] = trace.traceId;
    }

    next();
  };
}
