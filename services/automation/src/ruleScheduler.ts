import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { ruleEngine } from './services/ruleEngine';
import { AutomationRule } from './services/rules';

const logger = createLogger('automation-service');

export class RuleScheduler {
  async executeScheduledRules(): Promise<void> {
    logger.info('Executing scheduled rules');

    const rules = await db.query<{
      id: string;
      tenant_id: string;
      trigger: unknown;
      actions: unknown;
    }>(
      `SELECT id, tenant_id, trigger, actions
       FROM automation_rules
       WHERE is_active = true
         AND trigger->>'type' = 'schedule'`
    );

    for (const rule of rules.rows) {
      try {
        const automationRule: AutomationRule = {
          id: rule.id,
          tenantId: rule.tenant_id,
          name: '',
          description: '',
          trigger: rule.trigger as AutomationRule['trigger'],
          actions: rule.actions as AutomationRule['actions'],
          isActive: true,
        };

        const context = {};
        const shouldExecute = await ruleEngine.evaluateRule(automationRule, context);

        if (shouldExecute) {
          await ruleEngine.executeActions(automationRule, context);
          logger.info('Scheduled rule executed', { ruleId: rule.id });
        }
      } catch (error) {
        logger.error('Failed to execute scheduled rule', {
          ruleId: rule.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  }

  startScheduler(intervalMs: number = 60000): void {
    setInterval(() => {
      this.executeScheduledRules().catch(error => {
        logger.error('Scheduler error', error instanceof Error ? error : new Error(String(error)));
      });
    }, intervalMs);

    logger.info('Rule scheduler started', { intervalMs });
  }
}

export const ruleScheduler = new RuleScheduler();
