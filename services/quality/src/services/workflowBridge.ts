import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('quality-workflow-bridge');

async function ensureTokenTable(): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS workflow_task_tokens (
    token VARCHAR(128) PRIMARY KEY,
    review_queue_id UUID NOT NULL,
    workflow_task_id UUID NOT NULL,
    action VARCHAR(32) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  )`);
}

async function ensureReviewTask(
  tenantId: TenantId,
  reviewQueueId: string,
  action: 'retry' | 'resolve'
): Promise<string> {
  const taskId = randomUUID();
  await db.query(
    `INSERT INTO review_tasks (id, tenant_id, type, entity_id, status, priority, comments, created_at, updated_at)
     VALUES ($1, $2, 'document', $3, 'pending', 'high', '[]'::jsonb, NOW(), NOW())`,
    [taskId, tenantId, reviewQueueId]
  );

  return taskId;
}

export async function dispatchWorkflowTask(
  tenantId: TenantId,
  reviewQueueId: string,
  action: 'retry' | 'resolve',
  taskToken?: string
): Promise<string> {
  await ensureTokenTable();
  const token = taskToken || `${reviewQueueId}:${action}`;

  const existing = await db.query<{ workflow_task_id: string }>(
    'SELECT workflow_task_id FROM workflow_task_tokens WHERE token = $1',
    [token]
  );

  if (existing.rows[0]) {
    logger.info('Workflow task already dispatched', { reviewQueueId, action, token });
    return existing.rows[0].workflow_task_id;
  }

  const workflowTaskId = await ensureReviewTask(tenantId, reviewQueueId, action);
  await db.query(
    `INSERT INTO workflow_task_tokens (token, review_queue_id, workflow_task_id, action)
     VALUES ($1, $2, $3, $4)`,
    [token, reviewQueueId, workflowTaskId, action]
  );

  logger.info('Workflow task dispatched', { reviewQueueId, action, token });
  return workflowTaskId;
}
