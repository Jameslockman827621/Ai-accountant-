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
    // Get firm
    const firmResult = await db.query<{
      id: string;
      firm_name: string;
    }>(
      `SELECT id, firm_name FROM accountant_firms WHERE id = $1`,
      [firmId]
    );

    if (firmResult.rows.length === 0) return null;
    const firm = firmResult.rows[0];

    // Get client stats
    const clientsResult = await db.query<{
      total: number;
      active: number;
    }>(
      `SELECT 
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE is_active = true) as active
       FROM firm_clients
       WHERE firm_id = $1`,
      [firmId]
    );

    // Get pending approvals
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

    // Get compliance status
    const complianceResult = await db.query<{
      on_track: number;
      at_risk: number;
      overdue: number;
    }>(
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

    // Get client health
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

    const clients = clientsResult.rows[0];
    const compliance = complianceResult.rows[0];

    return {
      firmId: firm.id,
      firmName: firm.firm_name,
      totalClients: parseInt(clients?.total || '0', 10),
      activeClients: parseInt(clients?.active || '0', 10),
      totalRevenue: 0, // Would calculate from billing
      pendingApprovals: parseInt(approvalsResult.rows[0]?.count || '0', 10),
      complianceStatus: {
        onTrack: parseInt(compliance?.on_track || '0', 10),
        atRisk: parseInt(compliance?.at_risk || '0', 10),
        overdue: parseInt(compliance?.overdue || '0', 10),
      },
      clientHealth: healthResult.rows.map(row => ({
        clientId: row.client_tenant_id,
        clientName: row.client_name,
        healthScore: this.calculateHealthScore(
          parseInt(row.pending_tasks || '0', 10),
          parseInt(row.upcoming_deadlines || '0', 10)
        ),
        pendingTasks: parseInt(row.pending_tasks || '0', 10),
        upcomingDeadlines: parseInt(row.upcoming_deadlines || '0', 10),
      })),
    };
  }

  /**
   * Get client summary
   */
  async getClientSummary(firmId: string, clientTenantId: TenantId): Promise<ClientSummary | null> {
    // Verify client belongs to firm
    const clientResult = await db.query<{
      client_tenant_id: string;
      client_name: string;
    }>(
      `SELECT fc.client_tenant_id, t.name as client_name
       FROM firm_clients fc
       JOIN tenants t ON t.id = fc.client_tenant_id
       WHERE fc.firm_id = $1 AND fc.client_tenant_id = $2 AND fc.is_active = true`,
      [firmId, clientTenantId]
    );

    if (clientResult.rows.length === 0) return null;

    // Get task stats
    const tasksResult = await db.query<{
      pending: number;
      in_progress: number;
      completed: number;
    }>(
      `SELECT 
         COUNT(*) FILTER (WHERE status = 'pending') as pending,
         COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
         COUNT(*) FILTER (WHERE status = 'completed') as completed
       FROM autopilot_tasks
       WHERE tenant_id = $1`,
      [clientTenantId]
    );

    // Get deadline stats
    const deadlinesResult = await db.query<{
      upcoming: number;
      overdue: number;
    }>(
      `SELECT 
         COUNT(*) FILTER (WHERE due_date >= CURRENT_DATE AND status = 'pending') as upcoming,
         COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status = 'pending') as overdue
       FROM compliance_calendar
       WHERE tenant_id = $1`,
      [clientTenantId]
    );

    // Get SLA adherence
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
        parseInt(tasks?.pending || '0', 10),
        parseInt(deadlines?.upcoming || '0', 10)
      ),
      pendingTasks: parseInt(tasks?.pending || '0', 10),
      inProgressTasks: parseInt(tasks?.in_progress || '0', 10),
      completedTasks: parseInt(tasks?.completed || '0', 10),
      upcomingDeadlines: parseInt(deadlines?.upcoming || '0', 10),
      overdueDeadlines: parseInt(deadlines?.overdue || '0', 10),
      slaAdherence: parseFloat(sla?.adherence || '100'),
      recentActivity: [], // Would fetch from activity log
    };
  }

  private calculateHealthScore(pendingTasks: number, upcomingDeadlines: number): number {
    // Simple health score calculation
    let score = 100;
    score -= pendingTasks * 5;
    score -= upcomingDeadlines * 3;
    return Math.max(0, Math.min(100, score));
  }
}

export const firmPortalService = new FirmPortalService();
