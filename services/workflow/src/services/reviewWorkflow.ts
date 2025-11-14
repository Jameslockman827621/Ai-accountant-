import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import crypto from 'crypto';

const logger = createLogger('workflow-service');

export interface ReviewTask {
  id: string;
  tenantId: TenantId;
  type: 'document' | 'ledger_entry' | 'filing' | 'transaction';
  entityId: string;
  status: 'pending' | 'approved' | 'rejected' | 'needs_revision';
  assignedTo: UserId | null;
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
  updatedAt: Date;
  comments: Array<{
    userId: UserId;
    comment: string;
    timestamp: Date;
  }>;
}

export async function createReviewTask(
  tenantId: TenantId,
  type: ReviewTask['type'],
  entityId: string,
  priority: ReviewTask['priority'] = 'medium'
): Promise<string> {
  const taskId = crypto.randomUUID();

  await db.query(
    `INSERT INTO review_tasks (
      id, tenant_id, type, entity_id, status, priority, comments, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'pending', $5, '[]'::jsonb, NOW(), NOW())`,
    [taskId, tenantId, type, entityId, priority]
  );

  logger.info('Review task created', { taskId, tenantId, type, entityId });
  return taskId;
}

export async function assignReviewTask(
  taskId: string,
  assignedTo: UserId
): Promise<void> {
  await db.query(
    `UPDATE review_tasks
     SET assigned_to = $1, updated_at = NOW()
     WHERE id = $2`,
    [assignedTo, taskId]
  );

  logger.info('Review task assigned', { taskId, assignedTo });
}

export async function addCommentToTask(
  taskId: string,
  userId: UserId,
  comment: string
): Promise<void> {
  const task = await getReviewTask(taskId);
  if (!task) {
    throw new Error('Review task not found');
  }

  const newComment = {
    userId,
    comment,
    timestamp: new Date(),
  };

  const comments = [...task.comments, newComment];

  await db.query(
    `UPDATE review_tasks
     SET comments = $1::jsonb, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(comments), taskId]
  );

  logger.info('Comment added to review task', { taskId, userId });
}

export async function approveTask(taskId: string, userId: UserId): Promise<void> {
  await db.query(
    `UPDATE review_tasks
     SET status = 'approved', updated_at = NOW()
     WHERE id = $1`,
    [taskId]
  );

  await addCommentToTask(taskId, userId, 'Task approved');

  logger.info('Review task approved', { taskId, userId });
}

export async function rejectTask(
  taskId: string,
  userId: UserId,
  reason: string
): Promise<void> {
  await db.query(
    `UPDATE review_tasks
     SET status = 'rejected', updated_at = NOW()
     WHERE id = $1`,
    [taskId]
  );

  await addCommentToTask(taskId, userId, `Task rejected: ${reason}`);

  logger.info('Review task rejected', { taskId, userId, reason });
}

export async function getReviewTask(taskId: string): Promise<ReviewTask | null> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    type: string;
    entity_id: string;
    status: string;
    assigned_to: string | null;
    priority: string;
    comments: unknown;
    created_at: Date;
    updated_at: Date;
  }>(
    'SELECT * FROM review_tasks WHERE id = $1',
    [taskId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type as ReviewTask['type'],
    entityId: row.entity_id,
    status: row.status as ReviewTask['status'],
    assignedTo: row.assigned_to,
    priority: row.priority as ReviewTask['priority'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    comments: (row.comments as ReviewTask['comments']) || [],
  };
}

export async function getPendingTasks(
  tenantId: TenantId,
  assignedTo?: UserId
): Promise<ReviewTask[]> {
  let query = 'SELECT * FROM review_tasks WHERE tenant_id = $1 AND status = $2';
  const params: unknown[] = [tenantId, 'pending'];

  if (assignedTo) {
    query += ' AND assigned_to = $3';
    params.push(assignedTo);
  } else {
    query += ' AND assigned_to IS NULL';
  }

  query += ' ORDER BY priority DESC, created_at ASC';

  const result = await db.query<{
    id: string;
    tenant_id: string;
    type: string;
    entity_id: string;
    status: string;
    assigned_to: string | null;
    priority: string;
    comments: unknown;
    created_at: Date;
    updated_at: Date;
  }>(query, params);

  return result.rows.map(row => ({
    id: row.id,
    tenantId: row.tenant_id,
    type: row.type as ReviewTask['type'],
    entityId: row.entity_id,
    status: row.status as ReviewTask['status'],
    assignedTo: row.assigned_to,
    priority: row.priority as ReviewTask['priority'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    comments: (row.comments as ReviewTask['comments']) || [],
  }));
}
