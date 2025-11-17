import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { processPeriodEnd } from './periodEndProcessing';
import { postDepreciation } from './depreciation';
import { postAccrual } from './accrualsPrepayments';

const logger = createLogger('period-close-service');

export type CloseStatus = 'draft' | 'in_progress' | 'locked' | 'closed' | 'reopened';

export interface PeriodClose {
  id: string;
  tenantId: TenantId;
  entityId?: string;
  periodStart: Date;
  periodEnd: Date;
  closeStatus: CloseStatus;
  lockedAt?: Date;
  lockedBy?: UserId;
  closedAt?: Date;
  closedBy?: UserId;
  checklist: Record<string, boolean>;
  validationResults: Record<string, unknown>;
  varianceAlerts: Array<{
    type: string;
    accountCode?: string;
    thresholdAmount?: number;
    actualAmount?: number;
    varianceAmount?: number;
    severity: string;
  }>;
  requiredAttachments: string[];
  generatedReports: string[];
  exportPackageLocation?: string;
}

export interface CloseTask {
  id: string;
  periodCloseId: string;
  taskType: 'accrual' | 'depreciation' | 'prepayment' | 'reconciliation' | 'validation' | 'report' | 'tax' | 'filing' | 'approval';
  taskName: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'skipped';
  assignedTo?: UserId;
  dueDate?: Date;
  completedAt?: Date;
  blockerReason?: string;
  resultData?: Record<string, unknown>;
}

export class PeriodCloseService {
  /**
   * Create or get period close
   */
  async createPeriodClose(
    tenantId: TenantId,
    periodStart: Date,
    periodEnd: Date,
    entityId?: string
  ): Promise<string> {
    const result = await db.query<{ id: string }>(
      `SELECT id FROM period_close
       WHERE tenant_id = $1 AND entity_id IS NOT DISTINCT FROM $2
         AND period_start = $3 AND period_end = $4`,
      [tenantId, entityId || null, periodStart, periodEnd]
    );

    if (result.rows.length > 0) {
      return result.rows[0].id;
    }

    const closeId = randomUUID();

    await db.query(
      `INSERT INTO period_close (
        id, tenant_id, entity_id, period_start, period_end,
        close_status, checklist, validation_results, variance_alerts,
        required_attachments, generated_reports, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, NOW(), NOW())`,
      [
        closeId,
        tenantId,
        entityId || null,
        periodStart,
        periodEnd,
        'draft',
        JSON.stringify({}),
        JSON.stringify({}),
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify([]),
      ]
    );

    // Create initial tasks
    await this.createInitialTasks(closeId);

    logger.info('Period close created', { closeId, tenantId, periodStart, periodEnd });

    return closeId;
  }

  /**
   * Create initial close tasks
   */
  private async createInitialTasks(periodCloseId: string): Promise<void> {
    const tasks: Array<{ taskType: CloseTask['taskType']; taskName: string }> = [
      { taskType: 'accrual', taskName: 'Post accruals' },
      { taskType: 'depreciation', taskName: 'Post depreciation' },
      { taskType: 'prepayment', taskName: 'Amortize prepayments' },
      { taskType: 'reconciliation', taskName: 'Complete bank reconciliations' },
      { taskType: 'validation', taskName: 'Validate balances' },
      { taskType: 'report', taskName: 'Generate trial balance' },
      { taskType: 'tax', taskName: 'Calculate tax provisions' },
      { taskType: 'filing', taskName: 'Prepare filing documents' },
      { taskType: 'approval', taskName: 'Obtain management approval' },
    ];

    for (const task of tasks) {
      await db.query(
        `INSERT INTO period_close_tasks (
          id, period_close_id, task_type, task_name, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [randomUUID(), periodCloseId, task.taskType, task.taskName, 'pending']
      );
    }
  }

  /**
   * Start period close process
   */
  async startClose(closeId: string, tenantId: TenantId, startedBy: UserId): Promise<void> {
    await db.query(
      `UPDATE period_close
       SET close_status = 'in_progress', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [closeId, tenantId]
    );

    logger.info('Period close started', { closeId, startedBy });
  }

  /**
   * Lock period
   */
  async lockPeriod(closeId: string, tenantId: TenantId, lockedBy: UserId): Promise<void> {
    await db.query(
      `UPDATE period_close
       SET close_status = 'locked', locked_at = NOW(), locked_by = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [lockedBy, closeId, tenantId]
    );

    logger.info('Period locked', { closeId, lockedBy });
  }

  /**
   * Execute close tasks
   */
  async executeCloseTasks(closeId: string, tenantId: TenantId): Promise<{
    completed: number;
    failed: number;
    blocked: number;
  }> {
    const closeResult = await db.query<{
      period_start: Date;
      period_end: Date;
    }>(
      `SELECT period_start, period_end FROM period_close WHERE id = $1 AND tenant_id = $2`,
      [closeId, tenantId]
    );

    if (closeResult.rows.length === 0) {
      throw new Error('Period close not found');
    }

    const { period_start, period_end } = closeResult.rows[0];
    let completed = 0;
    let failed = 0;
    let blocked = 0;

    // Get pending tasks
    const tasksResult = await db.query<{
      id: string;
      task_type: string;
      task_name: string;
    }>(
      `SELECT id, task_type, task_name
       FROM period_close_tasks
       WHERE period_close_id = $1 AND status = 'pending'
       ORDER BY
         CASE task_type
           WHEN 'accrual' THEN 1
           WHEN 'depreciation' THEN 2
           WHEN 'prepayment' THEN 3
           WHEN 'reconciliation' THEN 4
           WHEN 'validation' THEN 5
           WHEN 'report' THEN 6
           WHEN 'tax' THEN 7
           WHEN 'filing' THEN 8
           WHEN 'approval' THEN 9
         END`,
      [closeId]
    );

    for (const task of tasksResult.rows) {
      try {
        await this.executeTask(closeId, tenantId, task.id, task.task_type, period_start, period_end);
        completed++;
      } catch (error) {
        logger.error('Task execution failed', {
          taskId: task.id,
          taskType: task.task_type,
          error: error instanceof Error ? error : new Error(String(error)),
        });

        await db.query(
          `UPDATE period_close_tasks
           SET status = 'blocked', blocker_reason = $1, updated_at = NOW()
           WHERE id = $2`,
          [error instanceof Error ? error.message : 'Unknown error', task.id]
        );
        blocked++;
      }
    }

    return { completed, failed, blocked };
  }

  /**
   * Execute individual task
   */
  private async executeTask(
    closeId: string,
    tenantId: TenantId,
    taskId: string,
    taskType: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<void> {
    await db.query(
      `UPDATE period_close_tasks
       SET status = 'in_progress', updated_at = NOW()
       WHERE id = $1`,
      [taskId]
    );

    let resultData: Record<string, unknown> = {};

    try {
      switch (taskType) {
        case 'accrual':
          resultData = await this.executeAccruals(tenantId, periodEnd);
          break;
        case 'depreciation':
          resultData = await this.executeDepreciation(tenantId, periodEnd);
          break;
        case 'prepayment':
          resultData = await this.executePrepayments(tenantId, periodEnd);
          break;
        case 'reconciliation':
          resultData = await this.executeReconciliation(tenantId, periodEnd);
          break;
        case 'validation':
          resultData = await this.executeValidation(tenantId, periodStart, periodEnd);
          break;
        case 'report':
          resultData = await this.executeReportGeneration(closeId, tenantId, periodStart, periodEnd);
          break;
        default:
          // Other tasks require manual completion
          return;
      }

      await db.query(
        `UPDATE period_close_tasks
         SET status = 'completed', completed_at = NOW(), result_data = $1::jsonb, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(resultData), taskId]
      );
    } catch (error) {
      await db.query(
        `UPDATE period_close_tasks
         SET status = 'blocked', blocker_reason = $1, updated_at = NOW()
         WHERE id = $2`,
        [error instanceof Error ? error.message : 'Unknown error', taskId]
      );
      throw error;
    }
  }

  /**
   * Execute accruals
   */
  private async executeAccruals(tenantId: TenantId, periodEnd: Date): Promise<Record<string, unknown>> {
    const accrualsResult = await db.query<{ id: string }>(
      `SELECT id FROM accruals
       WHERE tenant_id = $1 AND period_end <= $2 AND status = 'pending'`,
      [tenantId, periodEnd]
    );

    let postedCount = 0;
    for (const accrual of accrualsResult.rows) {
      try {
        await postAccrual(accrual.id, tenantId);
        postedCount++;
      } catch (error) {
        logger.error('Failed to post accrual', {
          accrualId: accrual.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return { postedCount, totalAccruals: accrualsResult.rows.length };
  }

  /**
   * Execute depreciation
   */
  private async executeDepreciation(tenantId: TenantId, periodEnd: Date): Promise<Record<string, unknown>> {
    const assetsResult = await db.query<{
      id: string;
      description: string;
      account_code: string;
      purchase_date: Date;
      purchase_cost: number;
      residual_value: number;
      useful_life: number;
      depreciation_method: string;
    }>(
      `SELECT id, description, account_code, purchase_date, purchase_cost,
              residual_value, useful_life, depreciation_method
       FROM fixed_assets
       WHERE tenant_id = $1 AND purchase_date <= $2`,
      [tenantId, periodEnd]
    );

    let postedCount = 0;
    for (const asset of assetsResult.rows) {
      try {
        await postDepreciation({
          id: asset.id,
          tenantId,
          description: asset.description,
          accountCode: asset.account_code,
          purchaseDate: asset.purchase_date,
          purchaseCost: asset.purchase_cost,
          residualValue: asset.residual_value,
          usefulLife: asset.useful_life,
          depreciationMethod: asset.depreciation_method as 'straight_line' | 'declining_balance',
        }, periodEnd);
        postedCount++;
      } catch (error) {
        logger.error('Failed to post depreciation', {
          assetId: asset.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return { postedCount, totalAssets: assetsResult.rows.length };
  }

  /**
   * Execute prepayments
   */
  private async executePrepayments(tenantId: TenantId, periodEnd: Date): Promise<Record<string, unknown>> {
    // Implementation would amortize prepayments
    return { amortizedCount: 0 };
  }

  /**
   * Execute reconciliation
   */
  private async executeReconciliation(tenantId: TenantId, periodEnd: Date): Promise<Record<string, unknown>> {
    const unreconciledResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM bank_transactions
       WHERE tenant_id = $1 AND date <= $2 AND reconciled = false`,
      [tenantId, periodEnd]
    );

    const unreconciledCount = parseInt(unreconciledResult.rows[0]?.count || '0', 10);

    return {
      unreconciledCount,
      requiresAttention: unreconciledCount > 0,
    };
  }

  /**
   * Execute validation
   */
  private async executeValidation(
    tenantId: TenantId,
    periodStart: Date,
    periodEnd: Date
  ): Promise<Record<string, unknown>> {
    // Validate double-entry balance
    const balanceResult = await db.query<{
      total_debits: string;
      total_credits: string;
    }>(
      `SELECT
         SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as total_debits,
         SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as total_credits
       FROM ledger_entries
       WHERE tenant_id = $1
         AND transaction_date BETWEEN $2 AND $3`,
      [tenantId, periodStart, periodEnd]
    );

    const totalDebits = parseFloat(balanceResult.rows[0]?.total_debits || '0');
    const totalCredits = parseFloat(balanceResult.rows[0]?.total_credits || '0');
    const difference = Math.abs(totalDebits - totalCredits);
    const isBalanced = difference < 0.01;

    return {
      isBalanced,
      totalDebits,
      totalCredits,
      difference,
    };
  }

  /**
   * Execute report generation
   */
  private async executeReportGeneration(
    closeId: string,
    tenantId: TenantId,
    periodStart: Date,
    periodEnd: Date
  ): Promise<Record<string, unknown>> {
    // Generate trial balance
    const trialBalance = await this.generateTrialBalance(tenantId, periodStart, periodEnd);

    // Store in generated reports
    await db.query(
      `UPDATE period_close
       SET generated_reports = generated_reports || $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify([{ type: 'trial_balance', generatedAt: new Date() }]), closeId]
    );

    return { trialBalanceGenerated: true };
  }

  /**
   * Generate trial balance
   */
  private async generateTrialBalance(
    tenantId: TenantId,
    periodStart: Date,
    periodEnd: Date
  ): Promise<Array<{ accountCode: string; accountName: string; debits: number; credits: number; balance: number }>> {
    const result = await db.query<{
      account_code: string;
      account_name: string;
      total_debits: string;
      total_credits: string;
    }>(
      `SELECT
         account_code,
         account_name,
         SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as total_debits,
         SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as total_credits
       FROM ledger_entries
       WHERE tenant_id = $1
         AND transaction_date BETWEEN $2 AND $3
       GROUP BY account_code, account_name
       ORDER BY account_code`,
      [tenantId, periodStart, periodEnd]
    );

    return result.rows.map((row) => {
      const debits = parseFloat(row.total_debits || '0');
      const credits = parseFloat(row.total_credits || '0');
      return {
        accountCode: row.account_code,
        accountName: row.account_name,
        debits,
        credits,
        balance: debits - credits,
      };
    });
  }

  /**
   * Check variance alerts
   */
  async checkVarianceAlerts(
    closeId: string,
    tenantId: TenantId,
    periodStart: Date,
    periodEnd: Date
  ): Promise<Array<{
    type: string;
    accountCode?: string;
    thresholdAmount?: number;
    actualAmount?: number;
    varianceAmount?: number;
    severity: string;
  }>> {
    const alerts: Array<{
      type: string;
      accountCode?: string;
      thresholdAmount?: number;
      actualAmount?: number;
      varianceAmount?: number;
      severity: string;
    }> = [];

    // Check cash balance drift
    const cashResult = await db.query<{ balance: string }>(
      `SELECT
         SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END) as balance
       FROM ledger_entries
       WHERE tenant_id = $1
         AND account_code LIKE '1000%'
         AND transaction_date <= $2`,
      [tenantId, periodEnd]
    );

    const cashBalance = parseFloat(cashResult.rows[0]?.balance || '0');

    // Get previous period cash balance
    const prevCashResult = await db.query<{ balance: string }>(
      `SELECT
         SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END) as balance
       FROM ledger_entries
       WHERE tenant_id = $1
         AND account_code LIKE '1000%'
         AND transaction_date < $2`,
      [tenantId, periodStart]
    );

    const prevCashBalance = parseFloat(prevCashResult.rows[0]?.balance || '0');
    const cashDrift = Math.abs(cashBalance - prevCashBalance);

    if (cashDrift > 1000) {
      alerts.push({
        type: 'balance_drift',
        accountCode: '1000',
        thresholdAmount: 1000,
        actualAmount: cashBalance,
        varianceAmount: cashDrift,
        severity: cashDrift > 10000 ? 'critical' : cashDrift > 5000 ? 'high' : 'medium',
      });
    }

    // Store alerts
    await db.query(
      `UPDATE period_close
       SET variance_alerts = $1::jsonb, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(alerts), closeId]
    );

    // Create variance alert records
    for (const alert of alerts) {
      await db.query(
        `INSERT INTO variance_alerts (
          id, tenant_id, period_close_id, alert_type, account_code,
          threshold_amount, actual_amount, variance_amount, severity, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
        [
          randomUUID(),
          tenantId,
          closeId,
          alert.type,
          alert.accountCode || null,
          alert.thresholdAmount || null,
          alert.actualAmount || null,
          alert.varianceAmount || null,
          alert.severity,
          'open',
        ]
      );
    }

    return alerts;
  }

  /**
   * Complete period close
   */
  async completeClose(closeId: string, tenantId: TenantId, closedBy: UserId): Promise<void> {
    // Validate all tasks are completed
    const tasksResult = await db.query<{ status: string }>(
      `SELECT status FROM period_close_tasks
       WHERE period_close_id = $1 AND status NOT IN ('completed', 'skipped')`,
      [closeId]
    );

    if (tasksResult.rows.length > 0) {
      throw new Error('Cannot close period: not all tasks are completed');
    }

    await db.query(
      `UPDATE period_close
       SET close_status = 'closed', closed_at = NOW(), closed_by = $1, updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [closedBy, closeId, tenantId]
    );

    logger.info('Period close completed', { closeId, closedBy });
  }

  /**
   * Get period close status
   */
  async getCloseStatus(closeId: string, tenantId: TenantId): Promise<PeriodClose | null> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      entity_id: string | null;
      period_start: Date;
      period_end: Date;
      close_status: string;
      locked_at: Date | null;
      locked_by: string | null;
      closed_at: Date | null;
      closed_by: string | null;
      checklist: unknown;
      validation_results: unknown;
      variance_alerts: unknown;
      required_attachments: unknown;
      generated_reports: unknown;
      export_package_location: string | null;
    }>(
      `SELECT id, tenant_id, entity_id, period_start, period_end, close_status,
              locked_at, locked_by, closed_at, closed_by, checklist, validation_results,
              variance_alerts, required_attachments, generated_reports, export_package_location
       FROM period_close
       WHERE id = $1 AND tenant_id = $2`,
      [closeId, tenantId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id as TenantId,
      entityId: row.entity_id || undefined,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      closeStatus: row.close_status as CloseStatus,
      lockedAt: row.locked_at || undefined,
      lockedBy: row.locked_by as UserId | undefined,
      closedAt: row.closed_at || undefined,
      closedBy: row.closed_by as UserId | undefined,
      checklist: (row.checklist as Record<string, boolean>) || {},
      validationResults: (row.validation_results as Record<string, unknown>) || {},
      varianceAlerts: (row.variance_alerts as PeriodClose['varianceAlerts']) || [],
      requiredAttachments: (row.required_attachments as string[]) || [],
      generatedReports: (row.generated_reports as string[]) || [],
      exportPackageLocation: row.export_package_location || undefined,
    };
  }

  /**
   * Get close tasks
   */
  async getCloseTasks(closeId: string): Promise<CloseTask[]> {
    const result = await db.query<{
      id: string;
      period_close_id: string;
      task_type: string;
      task_name: string;
      status: string;
      assigned_to: string | null;
      due_date: Date | null;
      completed_at: Date | null;
      blocker_reason: string | null;
      result_data: unknown;
    }>(
      `SELECT id, period_close_id, task_type, task_name, status,
              assigned_to, due_date, completed_at, blocker_reason, result_data
       FROM period_close_tasks
       WHERE period_close_id = $1
       ORDER BY
         CASE task_type
           WHEN 'accrual' THEN 1
           WHEN 'depreciation' THEN 2
           WHEN 'prepayment' THEN 3
           WHEN 'reconciliation' THEN 4
           WHEN 'validation' THEN 5
           WHEN 'report' THEN 6
           WHEN 'tax' THEN 7
           WHEN 'filing' THEN 8
           WHEN 'approval' THEN 9
         END`,
      [closeId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      periodCloseId: row.period_close_id,
      taskType: row.task_type as CloseTask['taskType'],
      taskName: row.task_name,
      status: row.status as CloseTask['status'],
      assignedTo: row.assigned_to as UserId | undefined,
      dueDate: row.due_date || undefined,
      completedAt: row.completed_at || undefined,
      blockerReason: row.blocker_reason || undefined,
      resultData: (row.result_data as Record<string, unknown>) || undefined,
    }));
  }
}

export const periodCloseService = new PeriodCloseService();
