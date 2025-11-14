import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import {
  createReviewTask,
  assignReviewTask,
  approveTask,
  rejectTask,
  getPendingTasks,
} from '../services/reviewWorkflow';
import {
  createApprovalWorkflow,
  approveWorkflow,
  rejectWorkflow,
  getPendingApprovals,
} from '../services/approvalWorkflow';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('workflow-service');

// Review workflows
router.post('/review', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { type, entityId, priority } = req.body;

    if (!type || !entityId) {
      throw new ValidationError('Type and entityId are required');
    }

    const taskId = await createReviewTask(
      req.user.tenantId,
      type,
      entityId,
      priority || 'medium'
    );

    res.status(201).json({ taskId });
  } catch (error) {
    logger.error('Create review task failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create review task' });
  }
});

router.get('/review/pending', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rawAssigned = Array.isArray(req.query.assignedTo)
      ? req.query.assignedTo[0]
      : req.query.assignedTo;
    const assignedTo = typeof rawAssigned === 'string' ? rawAssigned : undefined;
    const tasks = await getPendingTasks(req.user.tenantId, assignedTo);

    res.json({ tasks });
  } catch (error) {
    logger.error('Get pending tasks failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get pending tasks' });
  }
});

router.post('/review/:taskId/assign', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taskId } = req.params;
    if (!taskId) {
      res.status(400).json({ error: 'taskId is required' });
      return;
    }
    const { assignedTo } = req.body;

    if (!assignedTo) {
      throw new ValidationError('assignedTo is required');
    }

    await assignReviewTask(taskId, assignedTo);
    res.json({ message: 'Task assigned successfully' });
  } catch (error) {
    logger.error('Assign task failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to assign task' });
  }
});

router.post('/review/:taskId/approve', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taskId } = req.params;
    if (!taskId) {
      res.status(400).json({ error: 'taskId is required' });
      return;
    }
    await approveTask(taskId, req.user.userId);
    res.json({ message: 'Task approved successfully' });
  } catch (error) {
    logger.error('Approve task failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to approve task' });
  }
});

router.post('/review/:taskId/reject', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taskId } = req.params;
    if (!taskId) {
      res.status(400).json({ error: 'taskId is required' });
      return;
    }
    const { reason } = req.body;

    if (!reason) {
      throw new ValidationError('Reason is required');
    }

    await rejectTask(taskId, req.user.userId, reason);
    res.json({ message: 'Task rejected successfully' });
  } catch (error) {
    logger.error('Reject task failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to reject task' });
  }
});

// Approval workflows
router.post('/approval', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { entityType, entityId, approverIds, requiredApprovals } = req.body;

    if (!entityType || !entityId || !approverIds || !Array.isArray(approverIds)) {
      throw new ValidationError('entityType, entityId, and approverIds array are required');
    }

    const workflowId = await createApprovalWorkflow(
      req.user.tenantId,
      entityType,
      entityId,
      approverIds,
      requiredApprovals || 1
    );

    res.status(201).json({ workflowId });
  } catch (error) {
    logger.error('Create approval workflow failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create approval workflow' });
  }
});

router.get('/approval/pending', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const workflows = await getPendingApprovals(req.user.tenantId, req.user.userId);
    res.json({ workflows });
  } catch (error) {
    logger.error('Get pending approvals failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get pending approvals' });
  }
});

router.post('/approval/:workflowId/approve', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { workflowId } = req.params;
    if (!workflowId) {
      res.status(400).json({ error: 'workflowId is required' });
      return;
    }
    const { comment } = req.body;

    const isComplete = await approveWorkflow(workflowId, req.user.userId, comment);
    res.json({ message: 'Workflow approved', isComplete });
  } catch (error) {
    logger.error('Approve workflow failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to approve workflow' });
  }
});

router.post('/approval/:workflowId/reject', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { workflowId } = req.params;
    if (!workflowId) {
      res.status(400).json({ error: 'workflowId is required' });
      return;
    }
    const { reason } = req.body;

    if (!reason) {
      throw new ValidationError('Reason is required');
    }

    await rejectWorkflow(workflowId, req.user.userId, reason);
    res.json({ message: 'Workflow rejected successfully' });
  } catch (error) {
    logger.error('Reject workflow failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to reject workflow' });
  }
});

export { router as workflowRouter };
