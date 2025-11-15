import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('accountant-service');

export interface ClientSummary {
  tenantId: TenantId;
  name: string;
  status: 'active' | 'inactive' | 'pending';
  lastActivity: Date | null;
  revenue: number;
  expenses: number;
  profit: number;
  upcomingDeadlines: number;
  pendingTasks: number;
}

export interface ClientTask {
  id: string;
  tenantId: TenantId;
  entityType: 'document' | 'ledger_entry' | 'filing' | 'transaction';
  entityId: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected' | 'needs_revision';
  createdAt: Date;
  summary: string | null;
}

type TaskAction = 'approve' | 'reject' | 'needs_revision';

export async function getAccountantClients(accountantUserId: UserId): Promise<ClientSummary[]> {
  logger.info('Getting accountant clients', { accountantUserId });

  // Get all tenants where this user is an accountant
  const result = await db.query<{
    tenant_id: string;
    name: string;
    status: string;
    last_activity: Date | null;
  }>(
    `SELECT DISTINCT t.id as tenant_id, t.name, 
            CASE WHEN t.subscription_tier = 'accountant' THEN 'active' ELSE 'inactive' END as status,
            MAX(u.last_login_at) as last_activity
     FROM tenants t
     INNER JOIN users u ON u.tenant_id = t.id
     WHERE u.id = $1 AND u.role = 'accountant'
     GROUP BY t.id, t.name, t.subscription_tier`,
    [accountantUserId]
  );

  const clients: ClientSummary[] = [];

  for (const row of result.rows) {
    // Get financial summary
    const financialSummary = await db.query<{
      revenue: string | number;
      expenses: string | number;
    }>(
      `SELECT 
         COALESCE(SUM(CASE WHEN entry_type = 'credit' AND account_code LIKE '4%' THEN amount ELSE 0 END), 0) as revenue,
         COALESCE(SUM(CASE WHEN entry_type = 'debit' AND (account_code LIKE '5%' OR account_code LIKE '6%') THEN amount ELSE 0 END), 0) as expenses
       FROM ledger_entries
       WHERE tenant_id = $1
         AND transaction_date >= NOW() - INTERVAL '12 months'`,
      [row.tenant_id]
    );

    const revenue = typeof financialSummary.rows[0]?.revenue === 'number'
      ? financialSummary.rows[0].revenue
      : parseFloat(String(financialSummary.rows[0]?.revenue || '0'));
    const expenses = typeof financialSummary.rows[0]?.expenses === 'number'
      ? financialSummary.rows[0].expenses
      : parseFloat(String(financialSummary.rows[0]?.expenses || '0'));

    // Get upcoming deadlines
    const deadlinesResult = await db.query<{ count: string | number }>(
      `SELECT COUNT(*) as count
       FROM filings
       WHERE tenant_id = $1
         AND status IN ('draft', 'pending_approval')
         AND period_end <= NOW() + INTERVAL '30 days'`,
      [row.tenant_id]
    );

    const upcomingDeadlines = typeof deadlinesResult.rows[0]?.count === 'number'
      ? deadlinesResult.rows[0].count
      : parseInt(String(deadlinesResult.rows[0]?.count || '0'), 10);

    // Get pending tasks
    const tasksResult = await db.query<{ count: string | number }>(
      `SELECT COUNT(*) as count
       FROM review_tasks
       WHERE tenant_id = $1 AND status = 'pending'`,
      [row.tenant_id]
    );

    const pendingTasks = typeof tasksResult.rows[0]?.count === 'number'
      ? tasksResult.rows[0].count
      : parseInt(String(tasksResult.rows[0]?.count || '0'), 10);

    clients.push({
      tenantId: row.tenant_id,
      name: row.name,
      status: row.status as ClientSummary['status'],
      lastActivity: row.last_activity,
      revenue: Math.round(revenue * 100) / 100,
      expenses: Math.round(expenses * 100) / 100,
      profit: Math.round((revenue - expenses) * 100) / 100,
      upcomingDeadlines,
      pendingTasks,
    });
  }

  logger.info('Accountant clients retrieved', {
    accountantUserId,
    clientCount: clients.length,
  });

  return clients;
}

async function ensureAccountantAccess(
  accountantUserId: UserId,
  tenantId: TenantId
): Promise<void> {
  const accessResult = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count
     FROM users
     WHERE id = $1 AND tenant_id = $2 AND role = 'accountant'`,
    [accountantUserId, tenantId]
  );

  const count =
    typeof accessResult.rows[0]?.count === 'number'
      ? accessResult.rows[0].count
      : parseInt(String(accessResult.rows[0]?.count || '0'), 10);

  if (count === 0) {
    throw new Error('Accountant does not have access to this tenant');
  }
}

export async function switchClientContext(
  accountantUserId: UserId,
  targetTenantId: TenantId
): Promise<boolean> {
  logger.info('Switching client context', { accountantUserId, targetTenantId });

  // Verify accountant has access to this tenant
  await ensureAccountantAccess(accountantUserId, targetTenantId);

  // Store current context (in production, use session/Redis)
  await db.query(
    `INSERT INTO user_sessions (user_id, tenant_id, context_data, created_at, expires_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW() + INTERVAL '8 hours')
     ON CONFLICT (user_id) DO UPDATE
     SET tenant_id = $2, context_data = $3::jsonb, created_at = NOW(), expires_at = NOW() + INTERVAL '8 hours'`,
    [accountantUserId, targetTenantId, JSON.stringify({ switchedAt: new Date() })]
  );

  logger.info('Client context switched', { accountantUserId, targetTenantId });
  return true;
}

export async function performBulkOperation(
  tenantIds: TenantId[],
  operation: 'approve' | 'reject' | 'export' | 'categorize',
  parameters: Record<string, unknown> = {}
): Promise<{ success: number; failed: number; errors: Array<{ tenantId: TenantId; error: string }> }> {
  logger.info('Performing bulk operation', {
    tenantCount: tenantIds.length,
    operation,
    parameters,
  });

  let success = 0;
  let failed = 0;
  const errors: Array<{ tenantId: TenantId; error: string }> = [];

  for (const tenantId of tenantIds) {
    try {
      switch (operation) {
        case 'approve':
          // Bulk approve filings
          await db.query(
            `UPDATE filings
             SET status = 'approved', updated_at = NOW()
             WHERE tenant_id = $1 AND status = 'pending_approval'`,
            [tenantId]
          );
          break;

        case 'reject':
          // Bulk reject filings
          await db.query(
            `UPDATE filings
             SET status = 'rejected', updated_at = NOW()
             WHERE tenant_id = $1 AND status = 'pending_approval'`,
            [tenantId]
          );
          break;

        case 'categorize':
          // Trigger categorization for uncategorized transactions
          // This would call the categorization service
          break;

        case 'export':
          // Export data (would generate reports)
          break;
      }

      success++;
    } catch (error) {
      failed++;
      errors.push({
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info('Bulk operation completed', {
    operation,
    success,
    failed,
  });

  return { success, failed, errors };
}

export async function getClientTasks(
  accountantUserId: UserId,
  tenantId: TenantId,
  status: ClientTask['status'] = 'pending'
): Promise<ClientTask[]> {
  await ensureAccountantAccess(accountantUserId, tenantId);

  const tasks = await db.query<{
    id: string;
    tenant_id: string;
    type: ClientTask['entityType'];
    entity_id: string;
    priority: ClientTask['priority'];
    status: ClientTask['status'];
    created_at: Date;
    summary: string | null;
  }>(
    `SELECT
        rt.id,
        rt.tenant_id,
        rt.type,
        rt.entity_id,
        rt.priority,
        rt.status,
        rt.created_at,
        COALESCE(d.file_name, le.description, f.filing_type) AS summary
     FROM review_tasks rt
     LEFT JOIN documents d ON d.id = rt.entity_id AND rt.type = 'document'
     LEFT JOIN ledger_entries le ON le.id = rt.entity_id AND rt.type = 'ledger_entry'
     LEFT JOIN filings f ON f.id = rt.entity_id AND rt.type = 'filing'
     WHERE rt.tenant_id = $1
       AND ($2::text IS NULL OR rt.status = $2::text)
     ORDER BY rt.priority DESC, rt.created_at ASC
     LIMIT 50`,
    [tenantId, status || null]
  );

  return tasks.rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    entityType: row.type,
    entityId: row.entity_id,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    summary: row.summary,
  }));
}

export async function resolveClientTask(
  accountantUserId: UserId,
  tenantId: TenantId,
  taskId: string,
  action: TaskAction,
  comment?: string
): Promise<void> {
  await ensureAccountantAccess(accountantUserId, tenantId);
  const statusMap: Record<TaskAction, ClientTask['status']> = {
    approve: 'approved',
    reject: 'rejected',
    needs_revision: 'needs_revision',
  };

  const status = statusMap[action];
  const message =
    comment ||
    (action === 'approve'
      ? 'Approved by accountant portal'
      : action === 'reject'
      ? 'Rejected by accountant portal'
      : 'Sent back for revision by accountant portal');

  const result = await db.query(
    `UPDATE review_tasks
     SET status = $1,
         comments = COALESCE(comments, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object(
             'userId', $4,
             'comment', $5,
             'action', $6,
             'timestamp', NOW()
           )
         ),
         updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [status, taskId, tenantId, accountantUserId, message, action]
  );

  if (result.rowCount === 0) {
    throw new Error('Task not found or already updated');
  }

  logger.info('Task resolved', { tenantId, taskId, action, accountantUserId });
}
