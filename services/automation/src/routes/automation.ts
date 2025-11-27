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
import { slaTrackingService } from '../services/slaTracking';
import { ingestInvoice, listInvoices } from '../services/invoiceIngestion';

const router = Router();
const logger = createLogger('automation-service');

type RequiredUser = NonNullable<AuthRequest['user']>;

function ensureAuthenticated(
  req: AuthRequest,
  res: Response
): req is AuthRequest & { user: RequiredUser } {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function requireParam(
  value: string | undefined,
  res: Response,
  message: string
): value is string {
  if (!value) {
    res.status(400).json({ error: message });
    return false;
  }
  return true;
}

function getQueryString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && value.length > 0) {
    return value[0];
  }
  return undefined;
}

function getQueryNumber(value: unknown, fallback: number): number {
  const strValue = getQueryString(value);
  if (!strValue) {
    return fallback;
  }
  const parsed = Number(strValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Create automation rule
router.post('/rules', async (req: AuthRequest, res: Response) => {
  try {
    if (!ensureAuthenticated(req, res)) {
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
    if (!ensureAuthenticated(req, res)) {
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
    if (!ensureAuthenticated(req, res)) {
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
    if (!ensureAuthenticated(req, res)) {
      return;
    }
    const { playbookId } = req.params;
    if (!requireParam(playbookId, res, 'playbookId is required')) {
      return;
    }
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
    if (!ensureAuthenticated(req, res)) {
      return;
    }
    const { playbookId } = req.params;
    if (!requireParam(playbookId, res, 'playbookId is required')) {
      return;
    }
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
    if (!ensureAuthenticated(req, res)) {
      return;
    }
    const { playbookId } = req.params;
    if (!requireParam(playbookId, res, 'playbookId is required')) {
      return;
    }
    const limit = getQueryNumber(req.query.limit, 10);
    const runs = await listPlaybookRuns(req.user.tenantId, playbookId, limit);
    res.json({ runs });
  } catch (error) {
    logger.error('List playbook runs failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to load playbook runs' });
  }
});

router.post('/playbooks/:playbookId/runs/:runId/confirm', async (req: AuthRequest, res: Response) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }
    const { playbookId, runId } = req.params;
    if (!requireParam(playbookId, res, 'playbookId is required') ||
        !requireParam(runId, res, 'runId is required')) {
      return;
    }
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
    if (!ensureAuthenticated(req, res)) {
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
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const { ruleId } = req.params;
    if (!requireParam(ruleId, res, 'ruleId is required')) {
      return;
    }
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
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const { ruleId } = req.params;
    if (!requireParam(ruleId, res, 'ruleId is required')) {
      return;
    }

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
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const { ruleId } = req.params;
    if (!requireParam(ruleId, res, 'ruleId is required')) {
      return;
    }
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
    if (!ensureAuthenticated(req, res)) {
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
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const { agendaId } = req.params;
    if (!requireParam(agendaId, res, 'agendaId is required')) {
      return;
    }
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
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const statusFilter = getQueryString(req.query.status);
    const priorityFilter = getQueryString(req.query.priority);
    const assignedToFilter = getQueryString(req.query.assignedTo);
    const limit = getQueryNumber(req.query.limit, 50);
    const offset = getQueryNumber(req.query.offset, 0);

    let query = `
      SELECT * FROM autopilot_tasks
      WHERE tenant_id = $1
    `;
    const params: unknown[] = [req.user.tenantId];
    let paramCount = 2;

    if (statusFilter) {
      query += ` AND status = $${paramCount++}`;
      params.push(statusFilter);
    }

    if (priorityFilter) {
      query += ` AND priority = $${paramCount++}`;
      params.push(priorityFilter);
    }

    if (assignedToFilter) {
      query += ` AND assigned_to = $${paramCount++}`;
      params.push(assignedToFilter);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(limit, offset);

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
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const { taskId } = req.params;
    if (!requireParam(taskId, res, 'taskId is required')) {
      return;
    }
    const task = await autopilotEngine.getTask(taskId);

    if (!task || task.tenantId !== req.user.tenantId) {
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
    if (!ensureAuthenticated(req, res)) {
      return;
    }
    const { taskId } = req.params;
    if (!requireParam(taskId, res, 'taskId is required')) {
      return;
    }
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
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const { taskId } = req.params;
    if (!requireParam(taskId, res, 'taskId is required')) {
      return;
    }
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
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const { taskId } = req.params;
    if (!requireParam(taskId, res, 'taskId is required')) {
      return;
    }
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
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const { taskId } = req.params;
    if (!requireParam(taskId, res, 'taskId is required')) {
      return;
    }

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
    if (!ensureAuthenticated(req, res)) {
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
    if (!ensureAuthenticated(req, res)) {
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

// Get SLA statistics
router.get('/sla/stats', async (req: AuthRequest, res: Response) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const days = getQueryNumber(req.query.days, 30);
    const stats = await slaTrackingService.getSLAStats(req.user.tenantId, days);

    res.json({ stats });
  } catch (error) {
    logger.error('Get SLA stats failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get SLA stats' });
  }
});

// Get at-risk tasks
router.get('/sla/at-risk', async (req: AuthRequest, res: Response) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const limit = getQueryNumber(req.query.limit, 50);
    const tasks = await slaTrackingService.getAtRiskTasks(req.user.tenantId, limit);

    res.json({ tasks });
  } catch (error) {
    logger.error('Get at-risk tasks failed', error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: 'Failed to get at-risk tasks' });
  }
});

// Invoice ingestion for AP/AR pipelines
router.post('/invoices/ingest', (req: AuthRequest, res: Response) => {
  try {
    if (!ensureAuthenticated(req, res)) {
      return;
    }

    const { vendor, amount, currency, dueDate } = req.body;
    if (!vendor || !amount || !currency) {
      throw new ValidationError('vendor, amount, and currency are required');
    }

    const invoice = ingestInvoice({
      tenantId: req.user.tenantId,
      createdBy: req.user.userId,
      vendor,
      amount: Number(amount),
      currency,
      dueDate,
    });

    res.status(201).json({ invoice });
  } catch (error) {
    logger.error('Invoice ingestion failed', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to ingest invoice' });
  }
});

router.get('/invoices', (req: AuthRequest, res: Response) => {
  if (!ensureAuthenticated(req, res)) {
    return;
  }

  res.json({ invoices: listInvoices(req.user.tenantId) });
});

export { router as automationRouter };
