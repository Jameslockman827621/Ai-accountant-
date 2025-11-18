import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('automation-service');

type LedgerEntryInput = {
  tenantId: TenantId;
  description: string;
  transactionDate: Date;
  entries: Array<{
    entryType: 'debit' | 'credit';
    accountCode: string;
    accountName: string;
    amount: number;
  }>;
  createdBy: string;
};

async function postLedgerEntryStub(entry: LedgerEntryInput): Promise<void> {
  logger.info('Ledger posting stub executed', {
    tenantId: entry.tenantId,
    description: entry.description,
  });
}

async function sendNotificationStub(
  recipient: string,
  subject: string,
  message: string
): Promise<void> {
  logger.info('Notification stub executed', { recipient, subject, preview: message.slice(0, 100) });
}

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
  const ruleId = randomUUID();

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
      {
        const transactionId =
          typeof context.transactionId === 'string' ? context.transactionId : undefined;
        const category =
          typeof action.parameters.category === 'string' ? action.parameters.category : undefined;
        if (!transactionId || !category) {
          logger.warn('Cannot categorize transaction without id or category', {
            transactionId,
            category,
          });
          break;
        }
        await db.query(
          'UPDATE bank_transactions SET category = $1 WHERE id = $2 AND tenant_id = $3',
          [category, transactionId, tenantId]
        );
        logger.info('Transaction categorized', { transactionId, category });
      }
      break;
    case 'post_ledger':
      // Post to ledger using ledger service
      {
        const transactionId =
          typeof context.transactionId === 'string' ? context.transactionId : undefined;
        const accountCode =
          typeof action.parameters.accountCode === 'string'
            ? action.parameters.accountCode
            : undefined;
        if (!transactionId || !accountCode) {
          logger.warn('Cannot post ledger entry without transactionId or accountCode', {
            transactionId,
            accountCode,
          });
          break;
        }
        const transaction = await db.query<{
          amount: number;
          description: string | null;
          date: Date;
        }>(
          'SELECT amount, description, date FROM bank_transactions WHERE id = $1 AND tenant_id = $2',
          [transactionId, tenantId]
        );

        const tx = transaction.rows[0];
        if (!tx) {
          logger.warn('Transaction not found for ledger posting', { transactionId });
          break;
        }

        const accountName =
          typeof action.parameters.accountName === 'string'
            ? action.parameters.accountName
            : 'Automated Entry';
        const createdBy =
          typeof context.userId === 'string' && context.userId.length > 0
            ? context.userId
            : 'system';

        await postLedgerEntryStub({
          tenantId,
          description: tx.description || 'Automated posting',
          transactionDate: tx.date,
          entries: [
            {
              entryType: tx.amount >= 0 ? 'debit' : 'credit',
              accountCode,
              accountName,
              amount: Math.abs(tx.amount),
            },
            {
              entryType: tx.amount >= 0 ? 'credit' : 'debit',
              accountCode: '1100',
              accountName: 'Cash',
              amount: Math.abs(tx.amount),
            },
          ],
          createdBy,
        });
        logger.info('Posted to ledger (stub)', { transactionId, accountCode });
      }
      break;
    case 'send_notification':
      // Send notification via notification service
      {
        const recipient =
          typeof action.parameters.recipient === 'string' ? action.parameters.recipient : undefined;
        const message =
          typeof action.parameters.message === 'string' ? action.parameters.message : undefined;
        const subject =
          typeof action.parameters.subject === 'string'
            ? action.parameters.subject
            : 'Notification';

        if (!recipient || !message) {
          logger.warn('Notification parameters missing', {
            recipient,
            hasMessage: Boolean(message),
          });
          break;
        }

        await sendNotificationStub(recipient, subject, message);
      }
      break;
    case 'create_task':
      // Create review task
      {
        const entityType =
          typeof action.parameters.entityType === 'string'
            ? action.parameters.entityType
            : undefined;
        const entityId =
          typeof action.parameters.entityId === 'string' ? action.parameters.entityId : undefined;
        if (!entityType || !entityId) {
          logger.warn('Cannot create task without entity identifiers', { entityType, entityId });
          break;
        }
        await db.query(
          `INSERT INTO review_tasks (id, tenant_id, entity_type, entity_id, status, priority, created_at)
           VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
          [randomUUID(), tenantId, entityType, entityId, action.parameters.priority || 'medium']
        );
        logger.info('Review task created', { entityType, entityId });
      }
      break;
  }
}

export async function getRule(ruleId: string): Promise<AutomationRule | null> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    name: string;
    description: string;
    trigger: unknown;
    actions: unknown;
    is_active: boolean;
    priority: number;
  }>('SELECT * FROM automation_rules WHERE id = $1', [ruleId]);

  const row = result.rows[0];
  if (!row) {
    return null;
  }
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
