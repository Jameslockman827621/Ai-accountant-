import { Router, Response } from 'express';
import { createLogger } from '@ai-accountant/shared-utils';
import { AuthRequest } from '../middleware/auth';
import { createAutomationRule, getRule, executeRule } from '../services/rules';
import { db } from '@ai-accountant/database';
import { ValidationError } from '@ai-accountant/shared-utils';

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
