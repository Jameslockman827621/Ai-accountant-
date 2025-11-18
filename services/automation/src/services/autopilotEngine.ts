import { db } from '@ai-accountant/database';
import { randomUUID } from 'crypto';
import { TenantId } from '@ai-accountant/shared-types';
import { complianceCalendarService } from '../../../compliance/src/services/complianceCalendar';

export interface AutopilotAgenda {
  id: string;
  tenantId: TenantId;
  agendaDate: string;
  totalTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  overdueTasks: number;
  urgentCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  onTrackCount: number;
  atRiskCount: number;
  breachedCount: number;
  taskIds: string[];
}

export interface AutopilotTask {
  id: string;
  tenantId: TenantId;
  taskType: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  severity: 'normal' | 'warning' | 'critical';
  playbookId: string | null;
  workflowStage: string | null;
  assignedTo: string | null;
  assignedBy: string | null;
  assignmentMethod: string | null;
  autoAssigned: boolean;
  dueDate: string | null;
  slaHours: number | null;
  startedAt: string | null;
  completedAt: string | null;
  escalated: boolean;
  aiSummary: string | null;
  sourceEvidence: Record<string, unknown> | null;
  recommendedAction: string | null;
  confidenceScore: number | null;
  executedBy: string | null;
  executionMethod: string | null;
  executionResult: Record<string, unknown> | null;
  createdAt: string;
}

export interface TaskSignal {
  type: 'ingestion' | 'deadline' | 'anomaly' | 'reconciliation' | 'filing' | 'manual';
  source: string;
  data: Record<string, unknown>;
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

export class AutopilotEngine {
  /**
   * Generate daily agenda for tenant
   */
  async generateDailyAgenda(
    tenantId: TenantId,
    date: string = formatISODate(new Date())
  ): Promise<AutopilotAgenda> {
    // Check if agenda already exists
    const existingResult = await db.query<{ id: string }>(
      `SELECT id FROM autopilot_agenda
       WHERE tenant_id = $1 AND agenda_date = $2`,
      [tenantId, date]
    );

    const existingAgenda = existingResult.rows[0];
    if (existingAgenda?.id) {
      return this.getAgenda(existingAgenda.id);
    }

    // Generate tasks from signals
    const signals = await this.collectSignals(tenantId);
    const tasks = await this.createTasksFromSignals(tenantId, signals);

    // Calculate metrics
    const metrics = this.calculateAgendaMetrics(tasks);

    // Create agenda
    const agendaId = randomUUID();
    await db.query(
      `INSERT INTO autopilot_agenda (
        id, tenant_id, agenda_date,
        total_tasks, pending_tasks, in_progress_tasks, completed_tasks, overdue_tasks,
        urgent_count, high_count, medium_count, low_count,
        on_track_count, at_risk_count, breached_count,
        task_ids
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        agendaId,
        tenantId,
        date,
        metrics.total,
        metrics.pending,
        metrics.inProgress,
        metrics.completed,
        metrics.overdue,
        metrics.urgent,
        metrics.high,
        metrics.medium,
        metrics.low,
        metrics.onTrack,
        metrics.atRisk,
        metrics.breached,
        tasks.map((t) => t.id),
      ]
    );

    return this.getAgenda(agendaId);
  }

  /**
   * Collect signals from various sources
   */
  private async collectSignals(tenantId: TenantId): Promise<TaskSignal[]> {
    const signals: TaskSignal[] = [];

    // Ingestion signals
    const ingestionResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM ingestion_log
       WHERE tenant_id = $1
         AND processing_status = 'pending'
         AND ingested_at >= NOW() - INTERVAL '24 hours'`,
      [tenantId]
    );

    const pendingIngestion = parseInt(ingestionResult.rows[0]?.count || '0', 10);
    if (pendingIngestion > 10) {
      signals.push({
        type: 'ingestion',
        source: 'ingestion_log',
        data: { pendingCount: pendingIngestion },
        priority: pendingIngestion > 50 ? 'high' : 'medium',
      });
    }

    // Deadline signals
    const deadlines = await complianceCalendarService.getUpcomingDeadlines(tenantId, 7);
    for (const deadline of deadlines) {
      if (deadline.readinessScore < 50) {
        signals.push({
          type: 'deadline',
          source: 'compliance_calendar',
          data: {
            obligationId: deadline.id,
            filingType: deadline.filingType,
            dueDate: deadline.dueDate,
            readinessScore: deadline.readinessScore,
          },
          priority: new Date(deadline.dueDate) < new Date() ? 'urgent' : 'high',
        });
      }
    }

    // Reconciliation signals
    const reconciliationResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM bank_transactions
       WHERE tenant_id = $1
         AND reconciled = false
         AND date <= NOW() - INTERVAL '5 days'`,
      [tenantId]
    );

    const staleReconciliation = parseInt(reconciliationResult.rows[0]?.count || '0', 10);
    if (staleReconciliation > 0) {
      signals.push({
        type: 'reconciliation',
        source: 'bank_transactions',
        data: { staleCount: staleReconciliation },
        priority: staleReconciliation > 20 ? 'high' : 'medium',
      });
    }

    // Anomaly signals
    const anomalyResult = await db.query<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM anomaly_detections
       WHERE tenant_id = $1
         AND status = 'open'
         AND detected_at >= NOW() - INTERVAL '7 days'`,
      [tenantId]
    );

    const openAnomalies = parseInt(anomalyResult.rows[0]?.count || '0', 10);
    if (openAnomalies > 0) {
      signals.push({
        type: 'anomaly',
        source: 'anomaly_detections',
        data: { anomalyCount: openAnomalies },
        priority: 'high',
      });
    }

    return signals;
  }

  /**
   * Create tasks from signals
   */
  private async createTasksFromSignals(
    tenantId: TenantId,
    signals: TaskSignal[]
  ): Promise<AutopilotTask[]> {
    const tasks: AutopilotTask[] = [];

    for (const signal of signals) {
      const task = await this.createTaskFromSignal(tenantId, signal);
      tasks.push(task);
    }

    return tasks;
  }

  /**
   * Create task from signal
   */
  private async createTaskFromSignal(
    tenantId: TenantId,
    signal: TaskSignal
  ): Promise<AutopilotTask> {
    const taskId = randomUUID();
    const now = new Date();
    const dueDate = new Date(now);

    // Set due date based on priority
    switch (signal.priority) {
      case 'urgent':
        dueDate.setHours(dueDate.getHours() + 4);
        break;
      case 'high':
        dueDate.setHours(dueDate.getHours() + 24);
        break;
      case 'medium':
        dueDate.setDate(dueDate.getDate() + 2);
        break;
      case 'low':
        dueDate.setDate(dueDate.getDate() + 7);
        break;
    }

    // Generate AI summary
    const aiSummary = await this.generateAISummary(signal);
    const recommendedAction = await this.generateRecommendedAction(signal);

    await db.query(
      `INSERT INTO autopilot_tasks (
        id, tenant_id, task_type, title, description, priority, status, severity,
        source_evidence, ai_summary, recommended_action, due_date, sla_hours,
        auto_assigned, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15)`,
      [
        taskId,
        tenantId,
        signal.type,
        this.generateTaskTitle(signal),
        this.generateTaskDescription(signal),
        signal.priority,
        'pending',
        signal.priority === 'urgent' || signal.priority === 'high' ? 'critical' : 'normal',
        JSON.stringify(signal.data),
        aiSummary,
        recommendedAction,
        dueDate,
        this.calculateSLAHours(signal.priority),
        true,
        'autopilot_engine',
      ]
    );

    // Create SLA tracking
    await db.query(
      `INSERT INTO sla_tracking (
        tenant_id, task_id, sla_type, sla_hours, sla_start_time, sla_due_time
      ) VALUES ($1, $2, $3, $4, NOW(), $5)`,
      [tenantId, taskId, 'completion_time', this.calculateSLAHours(signal.priority), dueDate]
    );

    return this.getTask(taskId);
  }

  /**
   * Get agenda
   */
  async getAgenda(agendaId: string): Promise<AutopilotAgenda> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      agenda_date: string;
      total_tasks: number;
      pending_tasks: number;
      in_progress_tasks: number;
      completed_tasks: number;
      overdue_tasks: number;
      urgent_count: number;
      high_count: number;
      medium_count: number;
      low_count: number;
      on_track_count: number;
      at_risk_count: number;
      breached_count: number;
      task_ids: string[];
    }>(`SELECT * FROM autopilot_agenda WHERE id = $1`, [agendaId]);

    const row = result.rows[0];
    if (!row) {
      throw new Error('Agenda not found');
    }
    return {
      id: row.id,
      tenantId: row.tenant_id as TenantId,
      agendaDate: row.agenda_date,
      totalTasks: row.total_tasks,
      pendingTasks: row.pending_tasks,
      inProgressTasks: row.in_progress_tasks,
      completedTasks: row.completed_tasks,
      overdueTasks: row.overdue_tasks,
      urgentCount: row.urgent_count,
      highCount: row.high_count,
      mediumCount: row.medium_count,
      lowCount: row.low_count,
      onTrackCount: row.on_track_count,
      atRiskCount: row.at_risk_count,
      breachedCount: row.breached_count,
      taskIds: row.task_ids,
    };
  }

  /**
   * Get task
   */
  async getTask(taskId: string): Promise<AutopilotTask> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      task_type: string;
      title: string;
      description: string | null;
      priority: string;
      status: string;
      severity: string;
      playbook_id: string | null;
      workflow_stage: string | null;
      assigned_to: string | null;
      assigned_by: string | null;
      assignment_method: string | null;
      auto_assigned: boolean;
      due_date: string | null;
      sla_hours: number | null;
      started_at: string | null;
      completed_at: string | null;
      escalated: boolean;
      ai_summary: string | null;
      source_evidence: unknown;
      recommended_action: string | null;
      confidence_score: number | null;
      executed_by: string | null;
      execution_method: string | null;
      execution_result: unknown;
      created_at: string;
    }>(`SELECT * FROM autopilot_tasks WHERE id = $1`, [taskId]);

    const row = result.rows[0];
    if (!row) {
      throw new Error('Task not found');
    }
    return {
      id: row.id,
      tenantId: row.tenant_id as TenantId,
      taskType: row.task_type,
      title: row.title,
      description: row.description,
      priority: row.priority as AutopilotTask['priority'],
      status: row.status as AutopilotTask['status'],
      severity: row.severity as AutopilotTask['severity'],
      playbookId: row.playbook_id,
      workflowStage: row.workflow_stage,
      assignedTo: row.assigned_to,
      assignedBy: row.assigned_by,
      assignmentMethod: row.assignment_method,
      autoAssigned: row.auto_assigned,
      dueDate: row.due_date,
      slaHours: row.sla_hours,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      escalated: row.escalated,
      aiSummary: row.ai_summary,
      sourceEvidence: row.source_evidence as Record<string, unknown> | null,
      recommendedAction: row.recommended_action,
      confidenceScore: row.confidence_score,
      executedBy: row.executed_by,
      executionMethod: row.execution_method,
      executionResult: row.execution_result as Record<string, unknown> | null,
      createdAt: row.created_at,
    };
  }

  private generateTaskTitle(signal: TaskSignal): string {
    switch (signal.type) {
      case 'ingestion':
        return `Process ${signal.data.pendingCount} Pending Documents`;
      case 'deadline':
        return `Prepare ${signal.data.filingType} Filing (Due ${new Date(signal.data.dueDate as string).toLocaleDateString()})`;
      case 'reconciliation':
        return `Reconcile ${signal.data.staleCount} Stale Transactions`;
      case 'anomaly':
        return `Review ${signal.data.anomalyCount} Detected Anomalies`;
      default:
        return 'Review Required';
    }
  }

  private generateTaskDescription(signal: TaskSignal): string {
    switch (signal.type) {
      case 'ingestion':
        return `${signal.data.pendingCount} documents are awaiting processing in the ingestion pipeline.`;
      case 'deadline':
        return `Filing due ${new Date(signal.data.dueDate as string).toLocaleDateString()} with readiness score of ${signal.data.readinessScore}%.`;
      case 'reconciliation':
        return `${signal.data.staleCount} bank transactions are unreconciled and older than 5 days.`;
      case 'anomaly':
        return `${signal.data.anomalyCount} anomalies have been detected and require review.`;
      default:
        return 'Action required';
    }
  }

  private async generateAISummary(signal: TaskSignal): Promise<string> {
    // In production, would use AI to generate summary
    return `Automated task generated from ${signal.type} signal. Priority: ${signal.priority}.`;
  }

  private async generateRecommendedAction(signal: TaskSignal): Promise<string> {
    switch (signal.type) {
      case 'ingestion':
        return 'Review and process pending documents in the ingestion queue.';
      case 'deadline':
        return 'Prepare filing draft and check data completeness.';
      case 'reconciliation':
        return 'Match stale transactions to documents or create exception entries.';
      case 'anomaly':
        return 'Review anomaly details and determine if correction is needed.';
      default:
        return 'Review and take appropriate action.';
    }
  }

  private calculateSLAHours(priority: TaskSignal['priority']): number {
    switch (priority) {
      case 'urgent':
        return 4;
      case 'high':
        return 24;
      case 'medium':
        return 48;
      case 'low':
        return 168; // 7 days
    }
  }

  private calculateAgendaMetrics(tasks: AutopilotTask[]): {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    overdue: number;
    urgent: number;
    high: number;
    medium: number;
    low: number;
    onTrack: number;
    atRisk: number;
    breached: number;
  } {
    const now = new Date();

    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      overdue: tasks.filter(
        (t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'completed'
      ).length,
      urgent: tasks.filter((t) => t.priority === 'urgent').length,
      high: tasks.filter((t) => t.priority === 'high').length,
      medium: tasks.filter((t) => t.priority === 'medium').length,
      low: tasks.filter((t) => t.priority === 'low').length,
      onTrack: tasks.filter((t) => {
        if (!t.dueDate) return false;
        const hoursUntilDue = (new Date(t.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60);
        return hoursUntilDue > (t.slaHours || 24) * 0.5;
      }).length,
      atRisk: tasks.filter((t) => {
        if (!t.dueDate) return false;
        const hoursUntilDue = (new Date(t.dueDate).getTime() - now.getTime()) / (1000 * 60 * 60);
        return hoursUntilDue <= (t.slaHours || 24) * 0.5 && hoursUntilDue > 0;
      }).length,
      breached: tasks.filter(
        (t) => t.dueDate && new Date(t.dueDate) < now && t.status !== 'completed'
      ).length,
    };
  }
}

export const autopilotEngine = new AutopilotEngine();

function formatISODate(date: Date): string {
  const [isoDate] = date.toISOString().split('T');
  return isoDate ?? date.toISOString();
}
