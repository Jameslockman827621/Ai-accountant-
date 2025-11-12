import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('automation-service');

export interface AutomationRule {
  id: string;
  tenantId: TenantId;
  name: string;
  description: string;
  trigger: {
    type: 'transaction' | 'document' | 'schedule' | 'threshold';
    conditions: Record<string, unknown>;
  };
  actions: Array<{
    type: 'categorize' | 'post_to_ledger' | 'send_notification' | 'create_task';
    parameters: Record<string, unknown>;
  }>;
  isActive: boolean;
}

export class RuleEngine {
  async createRule(rule: AutomationRule): Promise<string> {
    const ruleId = crypto.randomUUID();

    await db.query(
      `INSERT INTO automation_rules (
        id, tenant_id, name, description, trigger, actions, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW(), NOW())`,
      [
        ruleId,
        rule.tenantId,
        rule.name,
        rule.description,
        JSON.stringify(rule.trigger),
        JSON.stringify(rule.actions),
        rule.isActive,
      ]
    );

    logger.info('Automation rule created', { ruleId, tenantId: rule.tenantId });
    return ruleId;
  }

  async evaluateRule(rule: AutomationRule, context: Record<string, unknown>): Promise<boolean> {
    const trigger = rule.trigger;

    switch (trigger.type) {
      case 'transaction':
        return this.evaluateTransactionTrigger(trigger.conditions, context);
      case 'threshold':
        return this.evaluateThresholdTrigger(trigger.conditions, context);
      default:
        return false;
    }
  }

  private evaluateTransactionTrigger(
    conditions: Record<string, unknown>,
    context: Record<string, unknown>
  ): boolean {
    if (conditions.amountMin && (context.amount as number) < (conditions.amountMin as number)) {
      return false;
    }
    if (conditions.amountMax && (context.amount as number) > (conditions.amountMax as number)) {
      return false;
    }
    if (conditions.description && !(context.description as string).includes(conditions.description as string)) {
      return false;
    }
    return true;
  }

  private evaluateThresholdTrigger(
    conditions: Record<string, unknown>,
    context: Record<string, unknown>
  ): boolean {
    const threshold = conditions.threshold as number;
    const value = context.value as number;
    return value >= threshold;
  }

  async executeActions(
    rule: AutomationRule,
    context: Record<string, unknown>
  ): Promise<void> {
    for (const action of rule.actions) {
      switch (action.type) {
        case 'categorize':
          await this.executeCategorizeAction(action.parameters, context);
          break;
        case 'post_to_ledger':
          await this.executePostToLedgerAction(action.parameters, context);
          break;
        case 'send_notification':
          await this.executeNotificationAction(action.parameters, context);
          break;
      }
    }
  }

  private async executeCategorizeAction(
    parameters: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<void> {
    logger.info('Executing categorize action', { parameters, context });
    // Implement categorization logic
  }

  private async executePostToLedgerAction(
    parameters: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<void> {
    logger.info('Executing post to ledger action', { parameters, context });
    // Implement ledger posting logic
  }

  private async executeNotificationAction(
    parameters: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<void> {
    logger.info('Executing notification action', { parameters, context });
    // Implement notification logic
  }
}

export const ruleEngine = new RuleEngine();
