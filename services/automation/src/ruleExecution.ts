import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { ruleEngine, AutomationRule } from './ruleEngine';

const logger = createLogger('automation-service');

// Rule Execution Engine with Event Triggers
export class RuleExecutionEngine {
  async executeRuleOnEvent(
    rule: AutomationRule,
    event: {
      type: string;
      data: Record<string, unknown>;
    }
  ): Promise<void> {
    logger.info('Executing rule on event', {
      ruleId: rule.id,
      eventType: event.type,
    });

    // Check if rule trigger matches event
    if (rule.trigger.type === 'transaction' && event.type === 'transaction.created') {
      const shouldExecute = await ruleEngine.evaluateRule(rule, event.data);
      if (shouldExecute) {
        await ruleEngine.executeActions(rule, event.data);
      }
    } else if (rule.trigger.type === 'document' && event.type === 'document.processed') {
      const shouldExecute = await ruleEngine.evaluateRule(rule, event.data);
      if (shouldExecute) {
        await ruleEngine.executeActions(rule, event.data);
      }
    }
  }

  async executeAllRulesForEvent(
    tenantId: string,
    event: {
      type: string;
      data: Record<string, unknown>;
    }
  ): Promise<{ executed: number; failed: number }> {
    const rules = await db.query<{
      id: string;
      trigger: unknown;
      actions: unknown;
    }>(
      `SELECT id, trigger, actions
       FROM automation_rules
       WHERE tenant_id = $1 AND is_active = true`,
      [tenantId]
    );

    let executed = 0;
    let failed = 0;

    for (const ruleRow of rules.rows) {
      try {
        const rule: AutomationRule = {
          id: ruleRow.id,
          tenantId,
          name: '',
          description: '',
          trigger: ruleRow.trigger as AutomationRule['trigger'],
          actions: ruleRow.actions as AutomationRule['actions'],
          isActive: true,
        };

        await this.executeRuleOnEvent(rule, event);
        executed++;
      } catch (error) {
        logger.error('Rule execution failed', {
          ruleId: ruleRow.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        failed++;
      }
    }

    return { executed, failed };
  }
}

export const ruleExecutionEngine = new RuleExecutionEngine();
