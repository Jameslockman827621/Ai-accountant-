import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('validation-service');

export interface BusinessRule {
  id: string;
  tenantId: TenantId;
  name: string;
  description: string;
  ruleType: 'validation' | 'calculation' | 'alert' | 'automation';
  condition: string; // JavaScript expression or SQL-like condition
  action: string; // What to do when rule triggers
  severity: 'error' | 'warning' | 'info';
  isActive: boolean;
  priority: number;
}

export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  details: Record<string, unknown>;
}

/**
 * Data validation rules engine with custom business rules
 */
export async function createBusinessRule(rule: Omit<BusinessRule, 'id'>): Promise<string> {
  const ruleId = crypto.randomUUID();

  await db.query(
    `INSERT INTO business_rules (
      id, tenant_id, name, description, rule_type, condition, action, severity, is_active, priority, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
    [
      ruleId,
      rule.tenantId,
      rule.name,
      rule.description,
      rule.ruleType,
      rule.condition,
      rule.action,
      rule.severity,
      rule.isActive,
      rule.priority,
    ]
  );

  logger.info('Business rule created', { ruleId, tenantId: rule.tenantId, name: rule.name });
  return ruleId;
}

/**
 * Evaluate all business rules for a transaction/document
 */
export async function evaluateBusinessRules(
  tenantId: TenantId,
  context: Record<string, unknown>
): Promise<RuleEvaluationResult[]> {
  logger.info('Evaluating business rules', { tenantId });

  const rules = await db.query<{
    id: string;
    name: string;
    rule_type: string;
    condition: string;
    action: string;
    severity: string;
    priority: number;
  }>(
    `SELECT id, name, rule_type, condition, action, severity, priority
     FROM business_rules
     WHERE tenant_id = $1 AND is_active = true
     ORDER BY priority DESC, created_at ASC`,
    [tenantId]
  );

  const results: RuleEvaluationResult[] = [];

  for (const rule of rules.rows) {
    try {
      const triggered = evaluateCondition(rule.condition, context);

      if (triggered) {
        const message = generateRuleMessage(rule.action, context);
        
        results.push({
          ruleId: rule.id,
          ruleName: rule.name,
          triggered: true,
          severity: rule.severity as 'error' | 'warning' | 'info',
          message,
          details: {
            ruleType: rule.rule_type,
            condition: rule.condition,
            action: rule.action,
          },
        });

        // Execute action if needed
        if (rule.rule_type === 'automation') {
          await executeRuleAction(rule.action, context, tenantId);
        }
      }
    } catch (error) {
      logger.error('Rule evaluation failed', {
        ruleId: rule.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results.sort((a, b) => {
    const severityOrder = { error: 3, warning: 2, info: 1 };
    return severityOrder[b.severity] - severityOrder[a.severity];
  });
}

function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  try {
    // Support various condition formats
    // Format 1: JavaScript expression
    if (condition.includes('&&') || condition.includes('||') || condition.includes('===')) {
      // Create safe evaluation context
      const safeContext = { ...context };
      // Use Function constructor for safer evaluation (still needs sanitization in production)
      const func = new Function('context', `return ${condition.replace(/\b(\w+)\b/g, 'context.$1')}`);
      return func(safeContext) === true;
    }

    // Format 2: SQL-like conditions
    if (condition.includes('>') || condition.includes('<') || condition.includes('=')) {
      return evaluateSQLCondition(condition, context);
    }

    // Format 3: Simple field checks
    const parts = condition.split(' ');
    if (parts.length === 3) {
      const [field, operator, value] = parts;
      const fieldValue = context[field];

      switch (operator) {
        case '==':
        case '=':
          return String(fieldValue) === String(value);
        case '!=':
        case '<>':
          return String(fieldValue) !== String(value);
        case '>':
          return Number(fieldValue) > Number(value);
        case '<':
          return Number(fieldValue) < Number(value);
        case '>=':
          return Number(fieldValue) >= Number(value);
        case '<=':
          return Number(fieldValue) <= Number(value);
        case 'contains':
          return String(fieldValue).includes(String(value));
        default:
          return false;
      }
    }

    return false;
  } catch (error) {
    logger.error('Condition evaluation error', {
      condition,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function evaluateSQLCondition(condition: string, context: Record<string, unknown>): boolean {
  // Simple SQL-like condition parser
  // Example: "amount > 1000 AND category == 'travel'"
  const andParts = condition.split(' AND ');
  const orParts = condition.split(' OR ');

  if (orParts.length > 1) {
    return orParts.some(part => evaluateSQLCondition(part.trim(), context));
  }

  if (andParts.length > 1) {
    return andParts.every(part => evaluateSQLCondition(part.trim(), context));
  }

  // Single condition
  const operators = ['>=', '<=', '!=', '==', '>', '<', '='];
  for (const op of operators) {
    if (condition.includes(op)) {
      const [left, right] = condition.split(op).map(s => s.trim());
      const leftValue = context[left] || left;
      const rightValue = context[right] || right;

      switch (op) {
        case '==':
        case '=':
          return String(leftValue) === String(rightValue);
        case '!=':
          return String(leftValue) !== String(rightValue);
        case '>':
          return Number(leftValue) > Number(rightValue);
        case '<':
          return Number(leftValue) < Number(rightValue);
        case '>=':
          return Number(leftValue) >= Number(rightValue);
        case '<=':
          return Number(leftValue) <= Number(rightValue);
        default:
          return false;
      }
    }
  }

  return false;
}

function generateRuleMessage(action: string, context: Record<string, unknown>): string {
  // Replace placeholders in action message
  let message = action;
  for (const [key, value] of Object.entries(context)) {
    message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return message;
}

async function executeRuleAction(
  action: string,
  context: Record<string, unknown>,
  tenantId: TenantId
): Promise<void> {
  // Parse action and execute
  if (action.startsWith('CREATE_TASK:')) {
    const taskType = action.split(':')[1];
    await db.query(
      `INSERT INTO review_tasks (id, tenant_id, type, entity_id, status, priority, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'pending', 'medium', NOW())`,
      [tenantId, taskType, context.entityId || context.id]
    );
  } else if (action.startsWith('SEND_ALERT:')) {
    const alertMessage = action.split(':')[1];
    logger.warn('Business rule alert', { tenantId, message: alertMessage, context });
    // Would integrate with notification service
  } else if (action.startsWith('BLOCK:')) {
    logger.error('Business rule blocked action', { tenantId, action, context });
    throw new Error(`Action blocked by business rule: ${action}`);
  }
}

/**
 * Predefined UK tax compliance rules
 */
export const UK_COMPLIANCE_RULES: Array<Omit<BusinessRule, 'id' | 'tenantId'>> = [
  {
    name: 'VAT Registration Threshold',
    description: 'Alert when turnover approaches VAT registration threshold',
    ruleType: 'alert',
    condition: 'rolling12MonthTurnover >= 80000 AND rolling12MonthTurnover < 90000',
    action: 'VAT registration threshold approaching. Current turnover: {rolling12MonthTurnover}',
    severity: 'warning',
    isActive: true,
    priority: 10,
  },
  {
    name: 'Large Transaction Alert',
    description: 'Flag transactions over £10,000 for review',
    ruleType: 'validation',
    condition: 'amount > 10000',
    action: 'Large transaction detected: £{amount}. Requires review for AML compliance.',
    severity: 'warning',
    isActive: true,
    priority: 8,
  },
  {
    name: 'Duplicate Invoice Check',
    description: 'Detect potential duplicate invoices',
    ruleType: 'validation',
    condition: 'invoiceNumber EXISTS AND duplicateCount > 0',
    action: 'Potential duplicate invoice detected: {invoiceNumber}',
    severity: 'error',
    isActive: true,
    priority: 9,
  },
  {
    name: 'Expense Receipt Required',
    description: 'Require receipt for expenses over £25',
    ruleType: 'validation',
    condition: 'amount > 25 AND receiptMissing == true',
    action: 'Receipt required for expense over £25: £{amount}',
    severity: 'error',
    isActive: true,
    priority: 7,
  },
  {
    name: 'PAYE Deadline Reminder',
    description: 'Alert 7 days before PAYE deadline',
    ruleType: 'alert',
    condition: 'daysUntilPAYEDeadline <= 7 AND daysUntilPAYEDeadline > 0',
    action: 'PAYE deadline in {daysUntilPAYEDeadline} days. Ensure submission is ready.',
    severity: 'warning',
    isActive: true,
    priority: 6,
  },
];
