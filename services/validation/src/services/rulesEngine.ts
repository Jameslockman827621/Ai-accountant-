import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('validation-service');

export interface ValidationRule {
  id: string;
  tenantId: TenantId;
  name: string;
  description: string;
  ruleType: 'amount' | 'date' | 'category' | 'duplicate' | 'custom';
  condition: string; // JSON or expression
  action: 'warn' | 'error' | 'block';
  isActive: boolean;
}

export interface ValidationResult {
  ruleId: string;
  ruleName: string;
  passed: boolean;
  message: string;
  severity: 'warn' | 'error' | 'block';
}

/**
 * Evaluate custom business rules
 */
export async function evaluateBusinessRules(
  tenantId: TenantId,
  data: Record<string, unknown>,
  context: 'transaction' | 'document' | 'filing' | 'ledger_entry'
): Promise<ValidationResult[]> {
  const rules = await db.query<{
    id: string;
    name: string;
    rule_type: string;
    condition: unknown;
    action: string;
  }>(
    `SELECT id, name, rule_type, condition, action
     FROM validation_rules
     WHERE tenant_id = $1 AND is_active = true AND rule_type = $2`,
    [tenantId, context]
  );

  const results: ValidationResult[] = [];

  for (const rule of rules.rows) {
    const condition = rule.condition as Record<string, unknown>;
    const passed = evaluateCondition(condition, data);

    if (!passed) {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        passed: false,
        message: generateMessage(rule.name, condition, data),
        severity: rule.action as 'warn' | 'error' | 'block',
      });
    }
  }

  return results;
}

function evaluateCondition(
  condition: Record<string, unknown>,
  data: Record<string, unknown>
): boolean {
  const operator = condition.operator as string;
  const field = condition.field as string;
  const value = condition.value;

  const dataValue = data[field];

  switch (operator) {
    case 'equals':
      return dataValue === value;
    case 'not_equals':
      return dataValue !== value;
    case 'greater_than':
      return typeof dataValue === 'number' && typeof value === 'number' && dataValue > value;
    case 'less_than':
      return typeof dataValue === 'number' && typeof value === 'number' && dataValue < value;
    case 'contains':
      return typeof dataValue === 'string' && typeof value === 'string' && dataValue.includes(value);
    case 'in':
      return Array.isArray(value) && value.includes(dataValue);
    case 'not_in':
      return Array.isArray(value) && !value.includes(dataValue);
    case 'regex':
      if (typeof dataValue === 'string' && typeof value === 'string') {
        return new RegExp(value).test(dataValue);
      }
      return false;
    default:
      return true;
  }
}

function generateMessage(
  ruleName: string,
  condition: Record<string, unknown>,
  data: Record<string, unknown>
): string {
  const field = condition.field as string;
  const operator = condition.operator as string;
  const value = condition.value;
  const dataValue = data[field];

  return `Rule "${ruleName}" failed: ${field} (${dataValue}) ${operator} ${value}`;
}

/**
 * Create custom validation rule
 */
export async function createValidationRule(rule: Omit<ValidationRule, 'id'>): Promise<string> {
  const ruleId = crypto.randomUUID();

  await db.query(
    `INSERT INTO validation_rules (
      id, tenant_id, name, description, rule_type, condition, action, is_active, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW(), NOW())`,
    [
      ruleId,
      rule.tenantId,
      rule.name,
      rule.description,
      rule.ruleType,
      JSON.stringify(rule.condition),
      rule.action,
      rule.isActive,
    ]
  );

  logger.info('Validation rule created', { ruleId, tenantId: rule.tenantId });
  return ruleId;
}
