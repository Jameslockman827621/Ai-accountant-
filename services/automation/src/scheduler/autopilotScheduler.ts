import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { autopilotEngine } from '../services/autopilotEngine';
import { taskExecutionService } from '../services/taskExecution';
import { taskAssignmentService } from '../services/taskAssignment';

const logger = createLogger('autopilot-scheduler');

export function startAutopilotScheduler(): void {
  // Generate daily agendas for all tenants (runs at midnight)
  const agendaInterval = 24 * 60 * 60 * 1000; // 24 hours
  const agendaRun = async () => {
    try {
      const tenants = await db.query<{ id: string }>(
        `SELECT id FROM tenants WHERE is_active = true`
      );

      for (const tenant of tenants.rows) {
        try {
          await autopilotEngine.generateDailyAgenda(tenant.id as string);
          logger.info('Generated daily agenda', { tenantId: tenant.id });
        } catch (error) {
          logger.error('Failed to generate agenda', {
            tenantId: tenant.id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    } catch (error) {
      logger.error('Agenda generation cycle failed', error instanceof Error ? error : new Error(String(error)));
    }
  };

  // Auto-assign pending tasks (runs every hour)
  const assignmentInterval = 60 * 60 * 1000; // 1 hour
  const assignmentRun = async () => {
    try {
      const tasks = await db.query<{
        id: string;
        tenant_id: string;
      }>(
        `SELECT id, tenant_id
         FROM autopilot_tasks
         WHERE status = 'pending'
           AND assigned_to IS NULL
           AND auto_assigned = true
         LIMIT 50`
      );

      for (const task of tasks.rows) {
        try {
          await taskAssignmentService.assignTask(
            task.id,
            task.tenant_id as string,
            'auto',
            'autopilot_scheduler' as string
          );
        } catch (error) {
          logger.error('Auto-assignment failed', {
            taskId: task.id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    } catch (error) {
      logger.error('Assignment cycle failed', error instanceof Error ? error : new Error(String(error)));
    }
  };

  // Execute auto-approved tasks (runs every 15 minutes)
  const executionInterval = 15 * 60 * 1000; // 15 minutes
  const executionRun = async () => {
    try {
      const tasks = await db.query<{
        id: string;
        tenant_id: string;
        execution_method: string;
      }>(
        `SELECT id, tenant_id, execution_method
         FROM autopilot_tasks
         WHERE status = 'pending'
           AND execution_method = 'ai_autonomous'
           AND assigned_to IS NOT NULL
         LIMIT 20`
      );

      for (const task of tasks.rows) {
        try {
          await taskExecutionService.executeTask(
            task.id,
            task.tenant_id as string,
            task.execution_method === 'ai_autonomous' ? 'ai_agent' : 'system',
            task.execution_method as 'ai_autonomous' | 'ai_supervised' | 'human',
            false
          );
        } catch (error) {
          logger.error('Auto-execution failed', {
            taskId: task.id,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
    } catch (error) {
      logger.error('Execution cycle failed', error instanceof Error ? error : new Error(String(error)));
    }
  };

  // Run immediately, then on intervals
  agendaRun().catch(() => undefined);
  assignmentRun().catch(() => undefined);
  executionRun().catch(() => undefined);

  setInterval(agendaRun, agendaInterval);
  setInterval(assignmentRun, assignmentInterval);
  setInterval(executionRun, executionInterval);

  logger.info('Autopilot scheduler started');
}
