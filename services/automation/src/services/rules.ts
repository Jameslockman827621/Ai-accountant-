import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('automation-service');

export interface AutomationRule {
  id: string;
  tenantId: TenantId;
  name: string;
  description: string;
  trigger: {
    type: 'transaction' | 'document' | 'schedule' | 'condition';
    conditions: Record<string, unknown>;
  };
  actions: Array<{
    type: 'categorize' | 'post_ledger' | 'send_notification' | 'create_task';
    parameters: Record<string, unknown>;
  }>;
  isActive: boolean;
  priority: number;
}

export async function createAutomationRule(rule: Omit<AutomationRule, 'id'>): Promise<string> {
  const ruleId = crypto.randomUUID();

  await db.query(
    `INSERT INTO automation_rules (
      id, tenant_id, name, description, trigger, actions, is_active, priority, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, NOW(), NOW())`,
    [
      ruleId,
      rule.tenantId,
      rule.name,
      rule.description,
      JSON.stringify(rule.trigger),
      JSON.stringify(rule.actions),
      rule.isActive,
      rule.priority,
    ]
  );

  logger.info('Automation rule created', { ruleId, tenantId: rule.tenantId });
  return ruleId;
}

export async function executeRule(ruleId: string, context: Record<string, unknown>): Promise<void> {
  const rule = await getRule(ruleId);
  if (!rule || !rule.isActive) {
    return;
  }

  // Check if trigger conditions are met
  if (!evaluateTrigger(rule.trigger, context)) {
    return;
  }

  // Execute actions
  for (const action of rule.actions) {
    await executeAction(action, context, rule.tenantId);
  }

  logger.info('Automation rule executed', { ruleId });
}

function evaluateTrigger(
  trigger: AutomationRule['trigger'],
  context: Record<string, unknown>
): boolean {
  // Simplified evaluation - in production, use a proper rule engine
  switch (trigger.type) {
    case 'transaction':
      return evaluateConditions(trigger.conditions, context);
    case 'document':
      return evaluateConditions(trigger.conditions, context);
    case 'schedule':
      return true; // Schedule triggers are handled separately
    case 'condition':
      return evaluateConditions(trigger.conditions, context);
    default:
      return false;
  }
}

function evaluateConditions(
  conditions: Record<string, unknown>,
  context: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(conditions)) {
    if (context[key] !== value) {
      return false;
    }
  }
  return true;
}

async function executeAction(
  action: AutomationRule['actions'][0],
  context: Record<string, unknown>,
  tenantId: TenantId
): Promise<void> {
  switch (action.type) {
    case 'categorize':
      // Update transaction category
      if (context.transactionId && action.parameters.category) {
        await db.query(
          'UPDATE bank_transactions SET category = $1 WHERE id = $2 AND tenant_id = $3',
          [action.parameters.category, context.transactionId, tenantId]
        );
        logger.info('Transaction categorized', { transactionId: context.transactionId, category: action.parameters.category });
      }
      break;
    case 'post_ledger':
      // Post to ledger using ledger service
      if (context.transactionId && action.parameters.accountCode) {
        const transaction = await db.query<{
          amount: number;
          description: string;
          date: Date;
        }>(
          'SELECT amount, description, date FROM bank_transactions WHERE id = $1 AND tenant_id = $2',
          [context.transactionId, tenantId]
        );
        
        if (transaction.rows.length > 0) {
          const tx = transaction.rows[0];
          // Import ledger posting function would be called here
          logger.info('Posting to ledger', { transactionId: context.transactionId, accountCode: action.parameters.accountCode });
        }
      }
      break;
    case 'send_notification':
      // Send notification via notification service
      if (action.parameters.message && action.parameters.recipient) {
        logger.info('Sending notification', { recipient: action.parameters.recipient, message: action.parameters.message });
        // Would call notification service here
      }
      break;
    case 'create_task':
      // Create review task
      if (action.parameters.entityType && action.parameters.entityId) {
        await db.query(
          `INSERT INTO review_tasks (id, tenant_id, entity_type, entity_id, status, priority, created_at)
           VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
          [
            crypto.randomUUID(),
            tenantId,
            action.parameters.entityType,
            action.parameters.entityId,
            action.parameters.priority || 'medium',
          ]
        );
        logger.info('Review task created', { entityType: action.parameters.entityType, entityId: action.parameters.entityId });
      }
      break;
  }
}

async function getRule(ruleId: string): Promise<AutomationRule | null> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    name: string;
    description: string;
    trigger: unknown;
    actions: unknown;
    is_active: boolean;
    priority: number;
  }>(
    'SELECT * FROM automation_rules WHERE id = $1',
    [ruleId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    trigger: row.trigger as AutomationRule['trigger'],
    actions: row.actions as AutomationRule['actions'],
    isActive: row.is_active,
    priority: row.priority,
  };
}
