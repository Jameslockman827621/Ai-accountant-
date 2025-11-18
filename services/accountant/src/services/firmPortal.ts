import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('firm-portal');

export interface FirmOverview {
  firmId: string;
  firmName: string;
  totalClients: number;
  activeClients: number;
  totalRevenue: number;
  pendingApprovals: number;
  complianceStatus: {
    onTrack: number;
    atRisk: number;
    overdue: number;
  };
  clientHealth: Array<{
    clientId: string;
    clientName: string;
    healthScore: number;
    pendingTasks: number;
    upcomingDeadlines: number;
  }>;
}

export interface ClientSummary {
  clientId: string;
  clientName: string;
  healthScore: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  upcomingDeadlines: number;
  overdueDeadlines: number;
  slaAdherence: number;
  recentActivity: Array<{
    type: string;
    message: string;
    timestamp: string;
  }>;
}

export class FirmPortalService {
  /**
   * Get firm overview
   */
  async getFirmOverview(firmId: string, userId: UserId): Promise<FirmOverview | null> {
    const firmResult = await db.query<{ id: string; firm_name: string }>(
      `SELECT id, firm_name FROM accountant_firms WHERE id = $1`,
      [firmId]
    );

    if (firmResult.rows.length === 0) {
      logger.warn('Firm not found for overview request', { firmId, userId });
      return null;
    }

    const clientsResult = await db.query<{ total: number; active: number }>(
      `SELECT 
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE is_active = true) as active
       FROM firm_clients
       WHERE firm_id = $1`,
      [firmId]
    );

    const approvalsResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM autopilot_tasks
       WHERE tenant_id IN (
         SELECT client_tenant_id FROM firm_clients WHERE firm_id = $1 AND is_active = true
       )
         AND status = 'pending'
         AND assigned_to = $2`,
      [firmId, userId]
    );

    const complianceResult = await db.query<{ on_track: number; at_risk: number; overdue: number }>(
      `SELECT 
         COUNT(*) FILTER (WHERE status = 'on_track') as on_track,
         COUNT(*) FILTER (WHERE status = 'at_risk') as at_risk,
         COUNT(*) FILTER (WHERE status = 'breached') as overdue
       FROM sla_tracking
       WHERE tenant_id IN (
         SELECT client_tenant_id FROM firm_clients WHERE firm_id = $1 AND is_active = true
       )
         AND status IN ('on_track', 'at_risk', 'breached')`,
      [firmId]
    );

    const healthResult = await db.query<{
      client_tenant_id: string;
      client_name: string;
      pending_tasks: number;
      upcoming_deadlines: number;
    }>(
      `SELECT 
         fc.client_tenant_id,
         t.name as client_name,
         COUNT(at.id) FILTER (WHERE at.status = 'pending') as pending_tasks,
         COUNT(cc.id) FILTER (WHERE cc.due_date >= CURRENT_DATE AND cc.status = 'pending') as upcoming_deadlines
       FROM firm_clients fc
       JOIN tenants t ON t.id = fc.client_tenant_id
       LEFT JOIN autopilot_tasks at ON at.tenant_id = fc.client_tenant_id
       LEFT JOIN compliance_calendar cc ON cc.tenant_id = fc.client_tenant_id
       WHERE fc.firm_id = $1 AND fc.is_active = true
       GROUP BY fc.client_tenant_id, t.name
       ORDER BY pending_tasks DESC
       LIMIT 10`,
      [firmId]
    );

    const firm = firmResult.rows[0];
    const clients = clientsResult.rows[0];
    const compliance = complianceResult.rows[0];

    return {
      firmId: firm.id,
      firmName: firm.firm_name,
      totalClients: this.parseNumeric(clients?.total),
      activeClients: this.parseNumeric(clients?.active),
      totalRevenue: 0, // Would calculate from billing
      pendingApprovals: this.parseNumeric(approvalsResult.rows[0]?.count),
      complianceStatus: {
        onTrack: this.parseNumeric(compliance?.on_track),
        atRisk: this.parseNumeric(compliance?.at_risk),
        overdue: this.parseNumeric(compliance?.overdue),
      },
      clientHealth: healthResult.rows.map(row => ({
        clientId: row.client_tenant_id,
        clientName: row.client_name,
        healthScore: this.calculateHealthScore(
          this.parseNumeric(row.pending_tasks),
          this.parseNumeric(row.upcoming_deadlines)
        ),
        pendingTasks: this.parseNumeric(row.pending_tasks),
        upcomingDeadlines: this.parseNumeric(row.upcoming_deadlines),
      })),
    };
  }

  /**
   * Get client summary
   */
  async getClientSummary(firmId: string, clientTenantId: TenantId): Promise<ClientSummary | null> {
    const clientResult = await db.query<{ client_tenant_id: string; client_name: string }>(
      `SELECT fc.client_tenant_id, t.name as client_name
       FROM firm_clients fc
       JOIN tenants t ON t.id = fc.client_tenant_id
       WHERE fc.firm_id = $1 AND fc.client_tenant_id = $2 AND fc.is_active = true`,
      [firmId, clientTenantId]
    );

    if (clientResult.rows.length === 0) {
      logger.warn('Client not found for firm summary', { firmId, clientTenantId });
      return null;
    }

    const tasksResult = await db.query<{ pending: number; in_progress: number; completed: number }>(
      `SELECT 
         COUNT(*) FILTER (WHERE status = 'pending') as pending,
         COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
         COUNT(*) FILTER (WHERE status = 'completed') as completed
       FROM autopilot_tasks
       WHERE tenant_id = $1`,
      [clientTenantId]
    );

    const deadlinesResult = await db.query<{ upcoming: number; overdue: number }>(
      `SELECT 
         COUNT(*) FILTER (WHERE due_date >= CURRENT_DATE AND status = 'pending') as upcoming,
         COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status = 'pending') as overdue
       FROM compliance_calendar
       WHERE tenant_id = $1`,
      [clientTenantId]
    );

    const slaResult = await db.query<{ adherence: number }>(
      `SELECT 
         CASE 
           WHEN COUNT(*) = 0 THEN 100
           ELSE (COUNT(*) FILTER (WHERE status = 'on_track')::numeric / COUNT(*)::numeric * 100)
         END as adherence
       FROM sla_tracking
       WHERE tenant_id = $1
         AND completed_at IS NOT NULL`,
      [clientTenantId]
    );

    const tasks = tasksResult.rows[0];
    const deadlines = deadlinesResult.rows[0];
    const sla = slaResult.rows[0];

    return {
      clientId: clientTenantId,
      clientName: clientResult.rows[0].client_name,
      healthScore: this.calculateHealthScore(
        this.parseNumeric(tasks?.pending),
        this.parseNumeric(deadlines?.upcoming)
      ),
      pendingTasks: this.parseNumeric(tasks?.pending),
      inProgressTasks: this.parseNumeric(tasks?.in_progress),
      completedTasks: this.parseNumeric(tasks?.completed),
      upcomingDeadlines: this.parseNumeric(deadlines?.upcoming),
      overdueDeadlines: this.parseNumeric(deadlines?.overdue),
      slaAdherence: this.parseNumeric(sla?.adherence) || 100,
      recentActivity: [], // Would fetch from activity log
    };
  }

  private calculateHealthScore(pendingTasks: number, upcomingDeadlines: number): number {
    let score = 100;
    score -= pendingTasks * 5;
    score -= upcomingDeadlines * 3;
    return Math.max(0, Math.min(100, score));
  }

  private parseNumeric(value: number | string | null | undefined): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }
    if (value === null || value === undefined) {
      return 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}

export const firmPortalService = new FirmPortalService();
