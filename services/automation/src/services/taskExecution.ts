import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { randomUUID } from 'crypto';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { policyEngine } from './policyEngine';

const logger = createLogger('task-execution');

export interface TaskExecutionResult {
  success: boolean;
  result: Record<string, unknown>;
  error?: string;
  rollbackData?: Record<string, unknown>;
}

export class TaskExecutionService {
  /**
   * Execute task (AI or human)
   */
  async executeTask(
    taskId: string,
    tenantId: TenantId,
    executedBy: UserId,
    executionMethod: 'ai_autonomous' | 'ai_supervised' | 'human',
    simulation: boolean = false
  ): Promise<TaskExecutionResult> {
    // Get task
    const taskResult = await db.query<{
      task_type: string;
      title: string;
      playbook_id: string | null;
      source_evidence: unknown;
      recommended_action: string | null;
    }>(
      `SELECT task_type, title, playbook_id, source_evidence, recommended_action
       FROM autopilot_tasks
       WHERE id = $1 AND tenant_id = $2`,
      [taskId, tenantId]
    );

    const task = taskResult.rows[0];
    if (!task) {
      throw new Error('Task not found');
    }

    // Check policy
    const policyResult = await policyEngine.evaluateAction(
      tenantId,
      executedBy,
      null,
      task.task_type,
      {
        executionMethod,
        taskType: task.task_type,
        ...(task.source_evidence as Record<string, unknown>),
      }
    );

    if (policyResult.action === 'block') {
      return {
        success: false,
        result: {},
        error: 'Action blocked by policy',
      };
    }

    if (policyResult.action === 'require_review' && executionMethod === 'ai_autonomous') {
      // Cannot execute autonomously, requires review
      return {
        success: false,
        result: {},
        error: 'Action requires review before execution',
      };
    }

    // Start task
    await db.query(
      `UPDATE autopilot_tasks
       SET status = 'in_progress',
           started_at = NOW(),
           executed_by = $1,
           execution_method = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [executedBy, executionMethod, taskId]
    );

    // Log execution start
    await this.logExecution(taskId, 'started', executedBy, executionMethod, null, 'in_progress');

    try {
      // Execute based on task type
      const evidence = (task.source_evidence as Record<string, unknown> | null) ?? {};
      const result = await this.executeTaskByType(task.task_type, tenantId, evidence, simulation);

      if (simulation) {
        // Return simulation result without updating task
        return result;
      }

      // Update task with result
      await db.query(
        `UPDATE autopilot_tasks
         SET status = 'completed',
             completed_at = NOW(),
             execution_result = $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(result.result), taskId]
      );

      // Update SLA tracking
      const { slaTrackingService } = await import('./slaTracking');
      await slaTrackingService.markCompleted(taskId);

      // Log completion
      await this.logExecution(
        taskId,
        'completed',
        executedBy,
        executionMethod,
        'in_progress',
        'completed',
        result.result
      );

      return result;
    } catch (error) {
      logger.error('Task execution failed', {
        taskId,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      await db.query(
        `UPDATE autopilot_tasks
         SET status = 'failed',
             error_message = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [error instanceof Error ? error.message : String(error), taskId]
      );

      await this.logExecution(
        taskId,
        'failed',
        executedBy,
        executionMethod,
        'in_progress',
        'failed',
        {},
        error instanceof Error ? error.message : String(error)
      );

      return {
        success: false,
        result: {},
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute task by type
   */
  private async executeTaskByType(
    taskType: string,
    tenantId: TenantId,
    evidence: Record<string, unknown>,
    simulation: boolean
  ): Promise<TaskExecutionResult> {
    switch (taskType) {
      case 'reconciliation':
        return this.executeReconciliation(tenantId, evidence, simulation);
      case 'posting':
        return this.executePosting(tenantId, evidence, simulation);
      case 'filing':
        return this.executeFiling(tenantId, evidence, simulation);
      case 'journal_entry':
        return this.executeJournalEntry(tenantId, evidence, simulation);
      case 'review':
        return this.executeReview(tenantId, evidence, simulation);
      default:
        return {
          success: false,
          result: {},
          error: `Unknown task type: ${taskType}`,
        };
    }
  }

  private async executeReconciliation(
    tenantId: TenantId,
    _evidence: Record<string, unknown>,
    simulation: boolean
  ): Promise<TaskExecutionResult> {
    // In production, would call reconciliation service
    logger.info('Executing reconciliation task', { tenantId, simulation });

    if (simulation) {
      return {
        success: true,
        result: {
          simulated: true,
          transactionsMatched: 5,
          transactionsUnmatched: 2,
        },
      };
    }

    // Actual execution would happen here
    return {
      success: true,
      result: {
        transactionsMatched: 5,
        transactionsUnmatched: 2,
      },
    };
  }

  private async executePosting(
    tenantId: TenantId,
    _evidence: Record<string, unknown>,
    simulation: boolean
  ): Promise<TaskExecutionResult> {
    logger.info('Executing posting task', { tenantId, simulation });

    if (simulation) {
      return {
        success: true,
        result: {
          simulated: true,
          documentsPosted: 10,
        },
      };
    }

    return {
      success: true,
      result: {
        documentsPosted: 10,
      },
    };
  }

  private async executeFiling(
    tenantId: TenantId,
    _evidence: Record<string, unknown>,
    simulation: boolean
  ): Promise<TaskExecutionResult> {
    logger.info('Executing filing task', { tenantId, simulation });

    if (simulation) {
      return {
        success: true,
        result: {
          simulated: true,
          filingDraftCreated: true,
        },
      };
    }

    // Would call filing lifecycle service
    return {
      success: true,
      result: {
        filingDraftCreated: true,
      },
    };
  }

  private async executeJournalEntry(
    tenantId: TenantId,
    _evidence: Record<string, unknown>,
    simulation: boolean
  ): Promise<TaskExecutionResult> {
    logger.info('Executing journal entry task', { tenantId, simulation });

    if (simulation) {
      return {
        success: true,
        result: {
          simulated: true,
          journalEntryCreated: true,
        },
      };
    }

    return {
      success: true,
      result: {
        journalEntryCreated: true,
      },
    };
  }

  private async executeReview(
    tenantId: TenantId,
    _evidence: Record<string, unknown>,
    simulation: boolean
  ): Promise<TaskExecutionResult> {
    logger.info('Executing review task', { tenantId, simulation });

    return {
      success: true,
      result: {
        reviewCompleted: true,
      },
    };
  }

  /**
   * Log execution action
   */
  private async logExecution(
    taskId: string,
    actionType: string,
    actionBy: UserId,
    actionMethod: string,
    previousStatus: string | null,
    newStatus: string,
    changes: Record<string, unknown> = {},
    error?: string
  ): Promise<void> {
    const historyId = randomUUID();
    await db.query(
      `INSERT INTO task_execution_history (
        id, task_id, action_type, action_by, action_method,
        previous_status, new_status, changes, reasoning, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
      [
        historyId,
        taskId,
        actionType,
        actionBy,
        actionMethod,
        previousStatus,
        newStatus,
        JSON.stringify(changes),
        `Task ${actionType} by ${actionMethod}`,
        error || null,
      ]
    );
  }

  /**
   * Rollback task execution
   */
  async rollbackTask(taskId: string, tenantId: TenantId, rolledBackBy: UserId): Promise<void> {
    // Get execution history
    const historyResult = await db.query<{
      rollback_data: unknown;
    }>(
      `SELECT rollback_data
       FROM task_execution_history
       WHERE task_id = $1
         AND action_type = 'completed'
         AND can_rollback = true
       ORDER BY action_timestamp DESC
       LIMIT 1`,
      [taskId]
    );

    const historyRow = historyResult.rows[0];
    if (!historyRow) {
      throw new Error('No rollback data available');
    }

    const rollbackData = historyRow.rollback_data as Record<string, unknown>;

    // Perform rollback (implementation depends on task type)
    logger.info('Rolling back task', { taskId, tenantId });

    // Update task status
    await db.query(
      `UPDATE autopilot_tasks
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1`,
      [taskId]
    );

    // Log rollback
    await this.logExecution(
      taskId,
      'rolled_back',
      rolledBackBy,
      'human',
      'completed',
      'cancelled',
      rollbackData
    );
  }
}

export const taskExecutionService = new TaskExecutionService();
