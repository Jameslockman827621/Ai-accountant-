import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { createAutomationRule, getRule, executeRule } from '../services/rules';
import { db } from '@ai-accountant/database';
import { ValidationError } from '@ai-accountant/shared-utils';
import {
  listPlaybookTemplates,
  listPlaybooks,
  createPlaybook,
  updatePlaybook,
  runPlaybookById,
  listPlaybookRuns,
  confirmPlaybookRun,
} from '../services/playbooks';
import { autopilotEngine } from '../services/autopilotEngine';
import { taskAssignmentService } from '../services/taskAssignment';
import { taskExecutionService } from '../services/taskExecution';
import { policyEngine } from '../services/policyEngine';

const router = Router();
const logger = createLogger('automation-service');

// Create automation rule
router.post('/rules', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { name, description, trigger, actions, isActive } = req.body;

    if (!name || !trigger || !actions) {
      throw new ValidationError('Name, trigger, and actions are required');
    }

    const rule = {
      tenantId: req.user.tenantId,
      name,
      description: description || '',
      trigger,
      actions,
      isActive: isActive !== false,
      priority: 0,
    };

    const ruleId = await createAutomationRule(rule);

    res.status(201).json({ ruleId });
  } catch (error) {
    logger.error('Create rule failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

router.get('/playbooks/templates', (_req: AuthRequest, res: Response) => {
  res.json({ templates: listPlaybookTemplates() });
});

router.get('/playbooks', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const playbooks = await listPlaybooks(req.user.tenantId);
    res.json({ playbooks });
  } catch (error) {
    logger.error('List playbooks failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to load playbooks' });
  }
});

router.post('/playbooks', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { templateKey, name, description, config, cadenceMinutes, confirmationRequired, status } =
      req.body;
    if (!templateKey) {
      throw new ValidationError('templateKey is required');
    }
    const playbook = await createPlaybook(req.user.tenantId, req.user.userId, {
      templateKey,
      name,
      description,
      config,
      cadenceMinutes,
      confirmationRequired,
      status,
    });
    res.status(201).json({ playbook });
  } catch (error) {
    logger.error('Create playbook failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create playbook' });
  }
});

router.patch('/playbooks/:playbookId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { playbookId } = req.params;
    const { status, config, cadenceMinutes, confirmationRequired } = req.body;
    const playbook = await updatePlaybook(req.user.tenantId, playbookId, {
      status,
      config,
      cadenceMinutes,
      confirmationRequired,
    });
    res.json({ playbook });
  } catch (error) {
    logger.error('Update playbook failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to update playbook' });
  }
});

router.post('/playbooks/:playbookId/run', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { playbookId } = req.params;
    const { force } = req.body ?? {};
    const run = await runPlaybookById(req.user.tenantId, playbookId, {
      triggeredBy: `user:${req.user.userId}`,
      force: Boolean(force),
    });
    res.json({ run });
  } catch (error) {
    logger.error('Run playbook failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to run playbook' });
  }
});

router.get('/playbooks/:playbookId/runs', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { playbookId } = req.params;
    const limit = Number(req.query.limit ?? 10);
    const runs = await listPlaybookRuns(req.user.tenantId, playbookId, limit);
    res.json({ runs });
  } catch (error) {
    logger.error('List playbook runs failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to load playbook runs' });
  }
});

router.post('/playbooks/:playbookId/runs/:runId/confirm', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { playbookId, runId } = req.params;
    const run = await confirmPlaybookRun(req.user.tenantId, playbookId, runId, req.user.userId);
    res.json({ run });
  } catch (error) {
    logger.error(
      'Confirm playbook run failed',
      error instanceof Error ? error : new Error(String(error))
    );
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to confirm playbook run' });
  }
});

// Get all rules
router.get('/rules', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await db.query(
      'SELECT * FROM automation_rules WHERE tenant_id = $1 ORDER BY created_at DESC',
      [req.user.tenantId]
    );

    res.json({ rules: result.rows });
  } catch (error) {
    logger.error('Get rules failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get rules' });
  }
});

// Update rule
router.put('/rules/:ruleId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { ruleId } = req.params;
    const { name, description, trigger, actions, isActive } = req.body;

    // Verify rule belongs to tenant
    const rule = await getRule(ruleId);
    if (!rule || rule.tenantId !== req.user.tenantId) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    await db.query(
      `UPDATE automation_rules
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           trigger = COALESCE($3::jsonb, trigger),
           actions = COALESCE($4::jsonb, actions),
           is_active = COALESCE($5, is_active),
           updated_at = NOW()
       WHERE id = $6 AND tenant_id = $7`,
      [
        name,
        description,
        trigger ? JSON.stringify(trigger) : null,
        actions ? JSON.stringify(actions) : null,
        isActive,
        ruleId,
        req.user.tenantId,
      ]
    );

    res.json({ message: 'Rule updated successfully' });
  } catch (error) {
    logger.error('Update rule failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to update rule' });
  }
});

// Delete rule
router.delete('/rules/:ruleId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { ruleId } = req.params;

    // Verify rule belongs to tenant
    const rule = await getRule(ruleId);
    if (!rule || rule.tenantId !== req.user.tenantId) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    await db.query('DELETE FROM automation_rules WHERE id = $1 AND tenant_id = $2', [
      ruleId,
      req.user.tenantId,
    ]);

    res.json({ message: 'Rule deleted successfully' });
  } catch (error) {
    logger.error('Delete rule failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

// Execute rule manually
router.post('/rules/:ruleId/execute', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { ruleId } = req.params;
    const { context } = req.body;

    // Verify rule belongs to tenant
    const rule = await getRule(ruleId);
    if (!rule || rule.tenantId !== req.user.tenantId) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    await executeRule(ruleId, context || {});

    res.json({ message: 'Rule executed successfully' });
  } catch (error) {
    logger.error('Execute rule failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to execute rule' });
  }
});

// Generate daily agenda
router.post('/autopilot/agenda', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { date } = req.body;
    const agenda = await autopilotEngine.generateDailyAgenda(req.user.tenantId, date);

    res.json({ agenda });
  } catch (error) {
    logger.error('Generate agenda failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to generate agenda' });
  }
});

// Get agenda
router.get('/autopilot/agenda/:agendaId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { agendaId } = req.params;
    const agenda = await autopilotEngine.getAgenda(agendaId);

    res.json({ agenda });
  } catch (error) {
    logger.error('Get agenda failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get agenda' });
  }
});

// List tasks
router.get('/tasks', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { status, priority, assignedTo, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT * FROM autopilot_tasks
      WHERE tenant_id = $1
    `;
    const params: unknown[] = [req.user.tenantId];
    let paramCount = 2;

    if (status) {
      query += ` AND status = $${paramCount++}`;
      params.push(status);
    }

    if (priority) {
      query += ` AND priority = $${paramCount++}`;
      params.push(priority);
    }

    if (assignedTo) {
      query += ` AND assigned_to = $${paramCount++}`;
      params.push(assignedTo);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit as string, 10), parseInt(offset as string, 10));

    const result = await db.query(query, params);

    res.json({ tasks: result.rows });
  } catch (error) {
    logger.error('List tasks failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

// Get task
router.get('/tasks/:taskId', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taskId } = req.params;
    const task = await autopilotEngine.getTask(taskId);

    if (task.tenantId !== req.user.tenantId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    res.json({ task });
  } catch (error) {
    logger.error('Get task failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get task' });
  }
});

// Assign task
router.post('/tasks/:taskId/assign', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taskId } = req.params;
    const { method, userId } = req.body;

    if (!method) {
      res.status(400).json({ error: 'Assignment method is required' });
      return;
    }

    const assignedUserId = await taskAssignmentService.assignTask(
      taskId,
      req.user.tenantId,
      method,
      req.user.userId,
      userId
    );

    res.json({ assignedTo: assignedUserId });
  } catch (error) {
    logger.error('Assign task failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to assign task' });
  }
});

// Get assignment suggestion
router.get('/tasks/:taskId/suggest-assignment', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taskId } = req.params;
    const suggestion = await taskAssignmentService.getAISuggestion(taskId, req.user.tenantId);

    res.json({ suggestion });
  } catch (error) {
    logger.error('Get assignment suggestion failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get suggestion' });
  }
});

// Execute task
router.post('/tasks/:taskId/execute', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taskId } = req.params;
    const { executionMethod, simulation } = req.body;

    const result = await taskExecutionService.executeTask(
      taskId,
      req.user.tenantId,
      req.user.userId,
      executionMethod || 'human',
      simulation || false
    );

    res.json({ result });
  } catch (error) {
    logger.error('Execute task failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to execute task' });
  }
});

// Get task execution history
router.get('/tasks/:taskId/history', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { taskId } = req.params;

    const result = await db.query(
      `SELECT * FROM task_execution_history
       WHERE task_id = $1
       ORDER BY action_timestamp DESC`,
      [taskId]
    );

    res.json({ history: result.rows });
  } catch (error) {
    logger.error('Get task history failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get task history' });
  }
});

// Evaluate policy
router.post('/policies/evaluate', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { actionType, context } = req.body;

    if (!actionType) {
      res.status(400).json({ error: 'Action type is required' });
      return;
    }

    const result = await policyEngine.evaluateAction(
      req.user.tenantId,
      req.user.userId,
      req.user.role,
      actionType,
      context || {}
    );

    res.json({ evaluation: result });
  } catch (error) {
    logger.error('Evaluate policy failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to evaluate policy' });
  }
});

// Create policy
router.post('/policies', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { policyName, policyType, scope, scopeId, conditions, actions, riskThreshold, priority } = req.body;

    if (!policyName || !policyType || !scope || !conditions || !actions) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const policyId = await policyEngine.createPolicy(
      req.user.tenantId,
      policyName,
      policyType,
      scope,
      scopeId || null,
      conditions,
      actions,
      riskThreshold || null,
      priority || 0,
      req.user.userId
    );

    res.json({ policyId });
  } catch (error) {
    logger.error('Create policy failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to create policy' });
  }
});

export { router as automationRouter };
