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

export async function switchClientContext(
  accountantUserId: UserId,
  targetTenantId: TenantId
): Promise<boolean> {
  logger.info('Switching client context', { accountantUserId, targetTenantId });

  // Verify accountant has access to this tenant
  const accessResult = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count
     FROM users
     WHERE id = $1 AND tenant_id = $2 AND role = 'accountant'`,
    [accountantUserId, targetTenantId]
  );

  const count = typeof accessResult.rows[0]?.count === 'number'
    ? accessResult.rows[0].count
    : parseInt(String(accessResult.rows[0]?.count || '0'), 10);

  if (count === 0) {
    throw new Error('Accountant does not have access to this tenant');
  }

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
