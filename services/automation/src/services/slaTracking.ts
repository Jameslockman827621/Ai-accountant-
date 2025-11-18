import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('sla-tracking');

export type SLAStatus = 'on_track' | 'at_risk' | 'breached';

export interface SLATracking {
  id: string;
  tenantId: TenantId;
  taskId: string;
  slaType: string;
  slaHours: number;
  slaStartTime: Date;
  slaDueTime: Date;
  status: SLAStatus;
  completedAt: Date | null;
  actualHours: number | null;
}

export class SLATrackingService {
  /**
   * Update SLA status based on current time
   */
  async updateSLAStatus(taskId: string): Promise<void> {
    const result = await db.query<{
      id: string;
      sla_due_time: Date;
      status: string;
      sla_hours: number;
    }>(
      `SELECT id, sla_due_time, status, sla_hours
         FROM sla_tracking
         WHERE task_id = $1 AND status != 'on_track'`,
      [taskId]
    );

    const tracking = result.rows[0];
    if (!tracking) {
      return;
    }
    const now = new Date();
    const dueTime = new Date(tracking.sla_due_time);
    const hoursUntilDue = (dueTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    let newStatus: SLAStatus = 'on_track';
    if (hoursUntilDue < 0) {
      newStatus = 'breached';
    } else if (hoursUntilDue < tracking.sla_hours * 0.5) {
      newStatus = 'at_risk';
    }

    if (newStatus !== tracking.status) {
      await db.query(
        `UPDATE sla_tracking
         SET status = $1, updated_at = NOW()
         WHERE id = $2`,
        [newStatus, tracking.id]
      );

      logger.info('SLA status updated', { taskId, oldStatus: tracking.status, newStatus });
    }
  }

  /**
   * Get SLA statistics for tenant
   */
  async getSLAStats(
    tenantId: TenantId,
    days: number = 30
  ): Promise<{
    onTrack: number;
    atRisk: number;
    breached: number;
    averageCompletionTime: number;
    adherenceRate: number;
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const result = await db.query<{
      status: string;
      count: string;
      avg_hours: string | null;
      completed_count: string;
    }>(
      `SELECT 
        status,
        COUNT(*) as count,
        AVG(actual_hours) as avg_hours,
        COUNT(CASE WHEN completed_at IS NOT NULL THEN 1 END) as completed_count
       FROM sla_tracking
       WHERE tenant_id = $1
         AND sla_start_time >= $2
       GROUP BY status`,
      [tenantId, since]
    );

    const stats = {
      onTrack: 0,
      atRisk: 0,
      breached: 0,
      averageCompletionTime: 0,
      adherenceRate: 0,
    };

    let totalCompleted = 0;
    let totalOnTime = 0;
    let totalHours = 0;

    for (const row of result.rows) {
      const count = parseInt(row.count, 10);
      if (row.status === 'on_track') stats.onTrack = count;
      if (row.status === 'at_risk') stats.atRisk = count;
      if (row.status === 'breached') stats.breached = count;

      if (row.avg_hours) {
        totalHours += parseFloat(row.avg_hours) * count;
      }

      const completed = parseInt(row.completed_count, 10);
      totalCompleted += completed;
      if (row.status === 'on_track') {
        totalOnTime += completed;
      }
    }

    if (totalCompleted > 0) {
      stats.averageCompletionTime = totalHours / totalCompleted;
      stats.adherenceRate = totalOnTime / totalCompleted;
    }

    return stats;
  }

  /**
   * Mark SLA as completed
   */
  async markCompleted(taskId: string): Promise<void> {
    const now = new Date();
    await db.query(
      `UPDATE sla_tracking
       SET status = 'on_track',
           completed_at = $1,
           actual_hours = EXTRACT(EPOCH FROM ($1 - sla_start_time)) / 3600,
           updated_at = $1
       WHERE task_id = $2`,
      [now, taskId]
    );
  }

  /**
   * Get tasks at risk or breached
   */
  async getAtRiskTasks(
    tenantId: TenantId,
    limit: number = 50
  ): Promise<
    Array<{
      taskId: string;
      status: SLAStatus;
      hoursUntilDue: number;
      slaHours: number;
    }>
  > {
    const result = await db.query<{
      task_id: string;
      status: string;
      sla_due_time: Date;
      sla_hours: number;
    }>(
      `SELECT task_id, status, sla_due_time, sla_hours
       FROM sla_tracking
       WHERE tenant_id = $1
         AND status IN ('at_risk', 'breached')
         AND completed_at IS NULL
       ORDER BY sla_due_time ASC
       LIMIT $2`,
      [tenantId, limit]
    );

    const now = new Date();
    return result.rows.map((row) => ({
      taskId: row.task_id,
      status: row.status as SLAStatus,
      hoursUntilDue: (new Date(row.sla_due_time).getTime() - now.getTime()) / (1000 * 60 * 60),
      slaHours: row.sla_hours,
    }));
  }
}

export const slaTrackingService = new SLATrackingService();
