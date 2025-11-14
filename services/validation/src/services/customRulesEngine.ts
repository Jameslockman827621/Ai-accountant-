import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import crypto from 'crypto';

const logger = createLogger('validation-service');

export interface ValidationRule {
  id: string;
  tenantId: TenantId;
  name: string;
  description: string;
  ruleType: 'amount' | 'date' | 'category' | 'vendor' | 'custom';
  condition: {
    field: string;
    operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'regex';
    value: unknown;
  };
  action: 'warn' | 'error' | 'auto_correct' | 'require_approval';
  isActive: boolean;
}

export interface ValidationResult {
  ruleId: string;
  ruleName: string;
  passed: boolean;
  message: string;
  action: ValidationRule['action'];
  suggestedCorrection?: unknown;
}

/**
 * Custom business rules engine for data validation
 */
export async function validateWithCustomRules(
  tenantId: TenantId,
  data: Record<string, unknown>,
  _context: 'transaction' | 'document' | 'ledger_entry' | 'filing'
): Promise<ValidationResult[]> {
  const rules = await db.query<{
    id: string;
    name: string;
    description: string;
    rule_type: string;
    condition: unknown;
    action: string;
    is_active: boolean;
  }>(
    `SELECT id, name, description, rule_type, condition, action, is_active
     FROM validation_rules
     WHERE tenant_id = $1 AND is_active = true`,
    [tenantId]
  );

  const results: ValidationResult[] = [];

  for (const rule of rules.rows) {
    const condition = rule.condition as ValidationRule['condition'];
    const passed = evaluateCondition(data, condition);

    if (!passed) {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        passed: false,
        message: `Rule violation: ${rule.description}`,
        action: rule.action as ValidationRule['action'],
        suggestedCorrection: generateCorrection(data, condition, rule.rule_type),
      });
    } else {
      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        passed: true,
        message: 'Rule passed',
        action: rule.action as ValidationRule['action'],
      });
    }
  }

  return results;
}

function evaluateCondition(
  data: Record<string, unknown>,
  condition: ValidationRule['condition']
): boolean {
  const fieldValue = data[condition.field];

  switch (condition.operator) {
    case 'equals':
      return fieldValue === condition.value;
    case 'not_equals':
      return fieldValue !== condition.value;
    case 'greater_than':
      return typeof fieldValue === 'number' && typeof condition.value === 'number' && fieldValue > condition.value;
    case 'less_than':
      return typeof fieldValue === 'number' && typeof condition.value === 'number' && fieldValue < condition.value;
    case 'contains':
      return typeof fieldValue === 'string' && typeof condition.value === 'string' && fieldValue.includes(condition.value);
    case 'regex':
      if (typeof fieldValue === 'string' && typeof condition.value === 'string') {
        return new RegExp(condition.value).test(fieldValue);
      }
      return false;
    default:
      return false;
  }
}

function generateCorrection(
  _data: Record<string, unknown>,
  condition: ValidationRule['condition'],
  _ruleType: string
): unknown {
  // Suggest corrections based on rule type
  if (condition.operator === 'greater_than' && typeof condition.value === 'number') {
    return condition.value;
  }
  if (condition.operator === 'less_than' && typeof condition.value === 'number') {
    return condition.value;
  }
  return condition.value;
}

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
