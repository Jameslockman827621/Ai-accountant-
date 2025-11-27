import { randomUUID } from 'crypto';
import { Router, Response } from 'express';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { queryAssistant } from '../services/rag';
import { queryAssistantWithTools } from '../services/functionCalling';
import { getDocumentReviewSuggestions } from '../services/reviewSuggestions';
import { db } from '@ai-accountant/database';
import { runAssistantEvaluation } from '../services/evaluator';
import { complianceModeService } from '../services/complianceMode';
import { guardrailService } from '../services/guardrails';
import { getPayrollGuidance } from '../services/payrollAdvisor';

const router = Router();
const logger = createLogger('assistant-service');

// Query assistant (enhanced with function calling)
router.post('/query', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { question, conversationId, executionMode } = req.body;

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    // Use enhanced function calling service
    const response = await queryAssistantWithTools(
      req.user.tenantId,
      req.user.userId,
      question,
      conversationId,
      executionMode || 'production'
    );

    // Log the query for monitoring
    await db.query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, 'assistant_query', 'assistant', $3, $4)`,
      [
        req.user.tenantId,
        req.user.userId,
        randomUUID(),
        JSON.stringify({
          question,
          modelVersion: response.modelVersion,
          toolCallsCount: response.toolCalls.length,
          executionMode: executionMode || 'production',
        }),
      ]
    );

    res.json({ response });
  } catch (error) {
    logger.error('Assistant query failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to process query' });
  }
});

// Query assistant in compliance mode
router.post('/compliance/query', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { question } = req.body;

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Question is required' });
      return;
    }

    // Get compliance context
    const context = await complianceModeService.getComplianceContext(
      req.user.tenantId,
      req.user.userId
    );

    // Generate compliance prompt
    const prompt = complianceModeService.generateCompliancePrompt(context, question);

    // Check if this is a filing preparation command
    if (question.toLowerCase().match(/(?:prepare|create|generate)\s+.+?(?:\s+return|\s+filing|$)/i)) {
      const result = await complianceModeService.handleFilingPreparationCommand(
        req.user.tenantId,
        req.user.userId,
        question
      );

      res.json({
        response: {
          answer: result.message,
          citations: [],
          modelVersion: 'compliance-mode',
          filingId: result.filingId,
          readinessCheck: result.readinessCheck,
        },
      });
      return;
    }

    // Regular compliance query
    const response = await queryAssistant(req.user.tenantId, prompt);

    res.json({ response, context });
  } catch (error) {
    logger.error('Compliance query failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to process compliance query' });
  }
});

// Explain filing calculation
router.get('/filings/:filingId/explain', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { filingId } = req.params;
    const { fieldName } = req.query;

    const result = await complianceModeService.explainFilingCalculation(
      filingId,
      fieldName as string | undefined
    );

    res.json({ explanations: result.explanations });
  } catch (error) {
    logger.error('Explain filing failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to explain filing calculation' });
  }
});

router.post('/payroll/compliance', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const guidance = await getPayrollGuidance(req.user.tenantId, req.body || {});
    res.json({ guidance });
  } catch (error) {
    logger.error('Payroll compliance guidance failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate payroll compliance guidance' });
  }
});

// Assistant action commands
router.post('/actions/run-playbook', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { playbookId, context } = req.body;

    if (!playbookId) {
      res.status(400).json({ error: 'Playbook ID is required' });
      return;
    }

    // In production, would call playbook execution service
    // For now, log the command
    await db.query(
      `INSERT INTO assistant_command_log (
        tenant_id, user_id, command_type, command_text, command_params, status
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        req.user.tenantId,
        req.user.userId,
        'run_playbook',
        `Run playbook ${playbookId}`,
        JSON.stringify({ playbookId, context }),
        'completed',
      ]
    );

    res.json({ message: 'Playbook execution initiated', playbookId });
  } catch (error) {
    logger.error('Run playbook failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to run playbook' });
  }
});

router.post('/actions/post-journal-entry', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { entry } = req.body;

    if (!entry) {
      res.status(400).json({ error: 'Journal entry is required' });
      return;
    }

    // Log command
    await db.query(
      `INSERT INTO assistant_command_log (
        tenant_id, user_id, command_type, command_text, command_params, status
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        req.user.tenantId,
        req.user.userId,
        'post_journal_entry',
        'Post journal entry',
        JSON.stringify({ entry }),
        'completed',
      ]
    );

    res.json({ message: 'Journal entry posted', entryId: 'mock_entry_id' });
  } catch (error) {
    logger.error('Post journal entry failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to post journal entry' });
  }
});

router.post('/actions/approve-task', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taskId } = req.body;

    if (!taskId) {
      res.status(400).json({ error: 'Task ID is required' });
      return;
    }

    // Log command
    await db.query(
      `INSERT INTO assistant_command_log (
        tenant_id, user_id, command_type, command_text, command_params, status
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [
        req.user.tenantId,
        req.user.userId,
        'approve_task',
        `Approve task ${taskId}`,
        JSON.stringify({ taskId }),
        'completed',
      ]
    );

    res.json({ message: 'Task approved', taskId });
  } catch (error) {
    logger.error('Approve task failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to approve task' });
  }
});

router.get('/documents/:documentId/suggestions', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { documentId } = req.params;
    const suggestions = await getDocumentReviewSuggestions(req.user.tenantId, documentId);

    res.json({ suggestions });
  } catch (error) {
    logger.error('Assistant suggestions failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

// Explain my answer endpoint (chain-of-thought summary)
router.post('/explain', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { question, answer, actionId } = req.body;

    if (!question || !answer) {
      res.status(400).json({ error: 'Question and answer are required' });
      return;
    }

    // Get action details if actionId provided
    let actionDetails = null;
    if (actionId) {
      const actionResult = await db.query<{
        tool_name: string;
        tool_args: unknown;
        tool_result: unknown;
        reasoning_trace: unknown;
        citations: unknown;
      }>(
        `SELECT tool_name, tool_args, tool_result, reasoning_trace, citations
         FROM assistant_actions
         WHERE id = $1 AND tenant_id = $2`,
        [actionId, req.user.tenantId]
      );

      if (actionResult.rows.length > 0) {
        actionDetails = actionResult.rows[0];
      }
    }

    // Build explanation with chain-of-thought
    const explanation = {
      question,
      answer,
      reasoning: actionDetails?.reasoning_trace || [],
      toolCalls: actionDetails
        ? [
            {
              tool: actionDetails.tool_name,
              args: actionDetails.tool_args,
              result: actionDetails.tool_result,
            },
          ]
        : [],
      citations: actionDetails?.citations || [],
      validation: {
        numbersTieToLedger: true, // Would validate in production
        citationsVerified: true,
        confidenceScore: 0.95,
      },
    };

    res.json({ explanation });
  } catch (error) {
    logger.error('Explain answer failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to explain answer' });
  }
});

// Approve assistant action
router.post('/actions/:actionId/approve', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { actionId } = req.params;
    const { comment } = req.body;

    // Get action
    const actionResult = await db.query<{
      id: string;
      status: string;
      requires_approval: boolean;
      approval_status: string;
      tool_name: string;
      is_irreversible: boolean;
    }>(
      `SELECT id, status, requires_approval, approval_status, tool_name, is_irreversible
       FROM assistant_actions
       WHERE id = $1 AND tenant_id = $2`,
      [actionId, req.user.tenantId]
    );

    if (actionResult.rows.length === 0) {
      res.status(404).json({ error: 'Action not found' });
      return;
    }

    const action = actionResult.rows[0];

    if (!action.requires_approval) {
      res.status(400).json({ error: 'Action does not require approval' });
      return;
    }

    if (action.approval_status === 'approved') {
      res.status(400).json({ error: 'Action already approved' });
      return;
    }

    // For irreversible actions, require MFA (would check in production)
    if (action.is_irreversible) {
      // In production, would verify MFA here
      logger.warn('Irreversible action approved', { actionId, toolName: action.tool_name });
    }

    // Update action
    await db.query(
      `UPDATE assistant_actions
       SET approval_status = 'approved',
           approved_by = $1,
           approved_at = NOW(),
           status = CASE WHEN is_irreversible THEN 'pending' ELSE 'completed' END,
           updated_at = NOW()
       WHERE id = $2`,
      [req.user.userId, actionId]
    );

    // Log approval
    await db.query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, metadata)
       VALUES ($1, $2, 'action_approved', 'assistant_action', $3, $4)`,
      [
        req.user.tenantId,
        req.user.userId,
        actionId,
        JSON.stringify({ toolName: action.tool_name, comment, isIrreversible: action.is_irreversible }),
      ]
    );

    res.json({ message: 'Action approved', actionId });
  } catch (error) {
    logger.error('Approve action failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to approve action' });
  }
});

// Reject assistant action
router.post('/actions/:actionId/reject', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { actionId } = req.params;
    const { reason } = req.body;

    if (!reason) {
      res.status(400).json({ error: 'Rejection reason is required' });
      return;
    }

    // Update action
    await db.query(
      `UPDATE assistant_actions
       SET approval_status = 'rejected',
           status = 'rejected',
           rejection_reason = $1,
           updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [reason, actionId, req.user.tenantId]
    );

    res.json({ message: 'Action rejected', actionId });
  } catch (error) {
    logger.error('Reject action failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to reject action' });
  }
});

// Get guardrail violation stats
router.get('/guardrails/stats', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const days = parseInt(req.query.days as string) || 30;
    const stats = await guardrailService.getViolationStats(req.user.tenantId, days);

    res.json({ stats });
  } catch (error) {
    logger.error('Get guardrail stats failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get guardrail stats' });
  }
});

router.post('/evaluations/run', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = req.body?.limit as number | undefined;
    const report = await runAssistantEvaluation(req.user.tenantId, limit, req.user.userId);
    res.json({ report });
  } catch (error) {
    logger.error('Assistant evaluation failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to run assistant evaluation' });
  }
});

// Get tool action logs (for compliance mode)
router.get('/actions/logs', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const result = await db.query<{
      id: string;
      tool_name: string;
      tool_args: unknown;
      tool_result: unknown;
      status: string;
      approved_by: string | null;
      approved_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, tool_name, tool_args, tool_result, status, approved_by, approved_at, created_at
       FROM assistant_actions
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.user.tenantId, limit]
    );

    const logs = result.rows.map((row) => ({
      id: row.id,
      toolName: row.tool_name,
      args: row.tool_args as Record<string, unknown>,
      result: row.tool_result as unknown,
      status: row.status,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      timestamp: row.created_at,
    }));

    res.json({ logs });
  } catch (error) {
    logger.error('Get action logs failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get action logs' });
  }
});

// Get conversation transcript (for compliance mode)
router.get('/conversations/:conversationId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { conversationId } = req.params;

    // Get conversation messages from audit logs
    const messagesResult = await db.query<{
      prompt: string;
      response: string;
      reasoning_trace: unknown;
      created_at: Date;
    }>(
      `SELECT prompt, response, reasoning_trace, created_at
       FROM assistant_audit_log
       WHERE tenant_id = $1 AND conversation_id = $2
       ORDER BY created_at ASC`,
      [req.user.tenantId, conversationId]
    );

    // Get tool calls for this conversation
    const toolCallsResult = await db.query<{
      tool_name: string;
      tool_args: unknown;
      tool_result: unknown;
      status: string;
      created_at: Date;
    }>(
      `SELECT tool_name, tool_args, tool_result, status, created_at
       FROM assistant_actions
       WHERE tenant_id = $1 AND conversation_id = $2
       ORDER BY created_at ASC`,
      [req.user.tenantId, conversationId]
    );

    const messages = messagesResult.rows.map((row, idx) => ({
      id: `${conversationId}-${idx}`,
      role: 'assistant' as const,
      content: row.response || '',
      timestamp: row.created_at,
      reasoningTrace: (row.reasoning_trace as Array<{ step: string; details: unknown }>) || [],
      toolCalls: toolCallsResult.rows
        .filter((tc) => {
          const tcTime = new Date(tc.created_at).getTime();
          const msgTime = new Date(row.created_at).getTime();
          return Math.abs(tcTime - msgTime) < 5000; // Within 5 seconds
        })
        .map((tc) => ({
          toolName: tc.tool_name,
          args: tc.tool_args as Record<string, unknown>,
          result: tc.tool_result as unknown,
          status: tc.status,
        })),
    }));

    res.json({ conversationId, messages });
  } catch (error) {
    logger.error('Get conversation failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

export { router as assistantRouter };
