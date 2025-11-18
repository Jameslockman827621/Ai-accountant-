import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { AutomationRule } from './rules';
import { db } from '@ai-accountant/database';
import { createReviewTask } from '@ai-accountant/workflow-service/services/reviewWorkflow';
import { createLedgerEntry } from '@ai-accountant/ledger-service/services/ledger';
import { sendEmail } from '@ai-accountant/notification-service/services/email';

const logger = createLogger('automation-service');

export class RuleEngine {
  async evaluateRule(rule: AutomationRule, context: Record<string, unknown>): Promise<boolean> {
    // Evaluate trigger conditions
    switch (rule.trigger.type) {
      case 'transaction':
        return this.evaluateTransactionTrigger(rule.trigger.conditions, context);
      case 'document':
        return this.evaluateDocumentTrigger(rule.trigger.conditions, context);
      case 'schedule':
        return this.evaluateScheduleTrigger(rule.trigger.conditions);
      case 'condition':
        return this.evaluateConditionTrigger(rule.trigger.conditions, context);
      default:
        return false;
    }
  }

  async executeActions(rule: AutomationRule, context: Record<string, unknown>): Promise<void> {
    for (const action of rule.actions) {
      try {
        await this.executeAction(action, context, rule.tenantId);
      } catch (error) {
        logger.error('Action execution failed', {
          ruleId: rule.id,
          actionType: action.type,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        // Continue with other actions
      }
    }
  }

  private evaluateTransactionTrigger(
    conditions: Record<string, unknown>,
    context: Record<string, unknown>
  ): boolean {
    // Check if context has transaction data
    if (!context.transactionId && !context.amount) {
      return false;
    }

    // Evaluate conditions
    for (const [key, value] of Object.entries(conditions)) {
      if (context[key] !== value) {
        return false;
      }
    }

    return true;
  }

  private evaluateDocumentTrigger(
    conditions: Record<string, unknown>,
    context: Record<string, unknown>
  ): boolean {
    if (!context.documentId) {
      return false;
    }

    for (const [key, value] of Object.entries(conditions)) {
      if (context[key] !== value) {
        return false;
      }
    }

    return true;
  }

  private evaluateScheduleTrigger(conditions: Record<string, unknown>): boolean {
    // Schedule triggers are evaluated by the scheduler
    const schedule = conditions.schedule as string;
    const currentTime = new Date();

    if (schedule === 'daily') {
      return true; // Scheduler handles timing
    } else if (schedule === 'weekly') {
      return currentTime.getDay() === ((conditions.dayOfWeek as number) || 0);
    } else if (schedule === 'monthly') {
      return currentTime.getDate() === ((conditions.dayOfMonth as number) || 1);
    }

    return false;
  }

  private evaluateConditionTrigger(
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

  private async executeAction(
    action: AutomationRule['actions'][0],
    context: Record<string, unknown>,
    tenantId: TenantId
  ): Promise<void> {
    switch (action.type) {
      case 'categorize':
        await this.categorizeTransaction(action.parameters, context, tenantId);
        break;

      case 'post_ledger':
        await this.postToLedger(action.parameters, context, tenantId);
        break;

      case 'send_notification':
        await this.sendNotification(action.parameters, context, tenantId);
        break;

      case 'create_task':
        await this.createReviewTask(action.parameters, context, tenantId);
        break;

      default:
        logger.warn('Unknown action type', { actionType: action.type });
    }
  }

  private async categorizeTransaction(
    parameters: Record<string, unknown>,
    context: Record<string, unknown>,
    tenantId: TenantId
  ): Promise<void> {
    const transactionId = context.transactionId as string;
    const category = parameters.category as string;

    if (!transactionId || !category) {
      return;
    }

    await db.query(
      `UPDATE bank_transactions
       SET category = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [category, transactionId, tenantId]
    );

    logger.info('Transaction categorized', { transactionId, category, tenantId });
  }

  private async postToLedger(
    parameters: Record<string, unknown>,
    context: Record<string, unknown>,
    tenantId: TenantId
  ): Promise<void> {
    const documentId = context.documentId as string;
    const accountCode = parameters.accountCode as string;
    const accountName = (parameters.accountName as string) || `Account ${accountCode}`;
    const amount = (parameters.amount as number) || (context.amount as number) || 0;

    if (!documentId || !accountCode || amount <= 0) {
      return;
    }

    // Create ledger entry
    await createLedgerEntry({
      tenantId,
      documentId,
      entryType: (parameters.entryType as 'debit' | 'credit') || 'debit',
      accountCode,
      accountName,
      amount,
      description: (parameters.description as string) || 'Automated posting',
      transactionDate: new Date((parameters.transactionDate as string) || Date.now()),
    });

    logger.info('Posted to ledger', { documentId, accountCode, tenantId });
  }

  private async sendNotification(
    parameters: Record<string, unknown>,
    _context: Record<string, unknown>,
    tenantId: TenantId
  ): Promise<void> {
    const email = parameters.email as string;
    const subject = (parameters.subject as string) || 'Automation Notification';
    const message = (parameters.message as string) || 'An automation rule was triggered';

    if (!email) {
      // Get tenant email
      const tenantResult = await db.query<{ email: string }>(
        `SELECT u.email
         FROM users u
         WHERE u.tenant_id = $1 AND u.role = 'client'
         LIMIT 1`,
        [tenantId]
      );

      const recipientRow = tenantResult.rows[0];
      if (!recipientRow) {
        logger.warn('No email found for notification', { tenantId });
        return;
      }

      const recipientEmail = recipientRow.email;
      await sendEmail(recipientEmail, subject, `<p>${message}</p>`);
    } else {
      await sendEmail(email, subject, `<p>${message}</p>`);
    }

    logger.info('Notification sent', { tenantId, email: email || 'tenant email' });
  }

  private async createReviewTask(
    parameters: Record<string, unknown>,
    context: Record<string, unknown>,
    tenantId: TenantId
  ): Promise<void> {
    const entityType = (parameters.entityType as string) || 'document';
    const contextRecord = context as Record<string, unknown>;
    const contextDocumentId =
      typeof contextRecord.documentId === 'string' ? contextRecord.documentId : undefined;
    const contextTransactionId =
      typeof contextRecord.transactionId === 'string' ? contextRecord.transactionId : undefined;
    const entityId = contextDocumentId || contextTransactionId;
    const priority = (parameters.priority as 'low' | 'medium' | 'high') || 'medium';

    if (!entityId) {
      return;
    }

    await createReviewTask(tenantId, entityType as any, entityId, priority);

    logger.info('Review task created', { tenantId, entityType, entityId });
  }
}

export const ruleEngine = new RuleEngine();
