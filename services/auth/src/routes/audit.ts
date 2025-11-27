import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { authorizeAction } from '../middleware/authorization';
import { AccessAction, approvalChains, accessPolicies } from '@ai-accountant/shared-types';
import { listAccessLogs } from '../services/auditLog';
import { approveRequest, listApprovalRequests, createApprovalRequest } from '../services/policyEngine';
import { AuthorizationError } from '@ai-accountant/shared-utils';

const router = Router();

router.get(
  '/access-logs',
  authenticate,
  authorizeAction(AccessAction.VIEW_AUDIT_LOGS),
  (req: AuthRequest, res: Response) => {
    const tenantId = req.user?.tenantId as string;
    const logs = listAccessLogs(tenantId);
    res.json({ logs });
  }
);

router.get(
  '/approvals',
  authenticate,
  authorizeAction(AccessAction.APPROVE_CHANGES),
  (req: AuthRequest, res: Response) => {
    const tenantId = req.user?.tenantId as string;
    const approvals = listApprovalRequests(tenantId);
    res.json({ approvals });
  }
);

router.get(
  '/policies',
  authenticate,
  authorizeAction(AccessAction.MANAGE_POLICIES),
  (_req: AuthRequest, res: Response) => {
    res.json({ policies: accessPolicies, approvalChains });
  }
);

router.post(
  '/approvals',
  authenticate,
  authorizeAction(AccessAction.MANAGE_USERS),
  (req: AuthRequest, res: Response) => {
    if (!req.user) {
      throw new AuthorizationError('Unauthenticated');
    }
    const { action, resourceId, reason } = req.body as {
      action: AccessAction;
      resourceId?: string;
      reason?: string;
    };

    const approval = createApprovalRequest(action, req.user.tenantId, req.user.userId, resourceId, reason);
    res.status(201).json({ approval });
  }
);

router.post(
  '/approvals/:approvalId/approve',
  authenticate,
  authorizeAction(AccessAction.APPROVE_CHANGES),
  (req: AuthRequest, res: Response) => {
    if (!req.user) {
      throw new AuthorizationError('Unauthenticated');
    }

    const { approvalId } = req.params;
    const { approved, note } = req.body as { approved: boolean; note?: string };

    const approval = approveRequest(approvalId, req.user.userId, req.user.role, {
      approved,
      note,
      actorId: req.user.userId,
    });

    res.json({ approval });
  }
);

export { router as auditRouter };
