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

export { router as automationRouter };
