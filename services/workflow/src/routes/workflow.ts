import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { approvalWorkflowService } from '../services/approvalWorkflow';
import { ValidationError } from '@ai-accountant/shared-utils';

const router = Router();
const logger = createLogger('workflow-service');

// Create approval workflow
router.post('/approvals', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingId, workflowType, policyType, steps, expiresInHours } = req.body;

    if (!workflowType || !policyType || !steps || !Array.isArray(steps)) {
      throw new ValidationError('Missing required fields');
    }

    const workflowId = await approvalWorkflowService.createWorkflow(
      req.user.tenantId,
      filingId || null,
      workflowType,
      policyType,
      steps,
      expiresInHours || 48
    );

    res.json({ workflowId });
  } catch (error) {
    logger.error('Create approval workflow failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create approval workflow' });
  }
});

// Approve step
router.post('/approvals/:workflowId/approve', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { workflowId } = req.params;
    const { stepNumber, comments, signatureHash } = req.body;

    if (!stepNumber) {
      throw new ValidationError('Step number is required');
    }

    await approvalWorkflowService.approveStep(
      workflowId,
      stepNumber,
      req.user.userId,
      comments,
      signatureHash,
      req.ip,
      req.headers['user-agent']
    );

    res.json({ message: 'Step approved' });
  } catch (error) {
    logger.error('Approve step failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to approve step' });
  }
});

// Reject workflow
router.post('/approvals/:workflowId/reject', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { workflowId } = req.params;
    const { stepNumber, reason } = req.body;

    if (!stepNumber || !reason) {
      throw new ValidationError('Step number and reason are required');
    }

    await approvalWorkflowService.rejectStep(
      workflowId,
      stepNumber,
      req.user.userId,
      reason,
      req.ip,
      req.headers['user-agent']
    );

    res.json({ message: 'Workflow rejected' });
  } catch (error) {
    logger.error('Reject workflow failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to reject workflow' });
  }
});

// Get workflow
router.get('/approvals/:workflowId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { workflowId } = req.params;
    const workflow = await approvalWorkflowService.getWorkflow(workflowId);

    if (!workflow) {
      res.status(404).json({ error: 'Workflow not found' });
      return;
    }

    res.json({ workflow });
  } catch (error) {
    logger.error('Get workflow failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get workflow' });
  }
});

// Get workflow history
router.get('/approvals/:workflowId/history', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { workflowId } = req.params;
    const history = await approvalWorkflowService.getWorkflowHistory(workflowId);

    res.json({ history });
  } catch (error) {
    logger.error('Get workflow history failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get workflow history' });
  }
});

export { router as workflowRouter };
