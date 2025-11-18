import { db } from '@ai-accountant/database';
import { TenantId, UserId } from '@ai-accountant/shared-types';

export type AssignmentMethod = 'auto' | 'round_robin' | 'skill_based' | 'manual' | 'ai_suggestion';

export interface AssignmentSuggestion {
  userId: string;
  userName: string;
  role: string;
  confidence: number;
  reasons: string[];
}

export class TaskAssignmentService {
  /**
   * Assign task using specified method
   */
  async assignTask(
    taskId: string,
    tenantId: TenantId,
    method: AssignmentMethod,
    assignedBy: UserId,
    preferredUserId?: UserId
  ): Promise<string | null> {
    let assignedUserId: string | null = null;

    switch (method) {
      case 'auto':
        assignedUserId = await this.autoAssign(taskId, tenantId);
        break;
      case 'round_robin':
        assignedUserId = await this.roundRobinAssign(tenantId);
        break;
      case 'skill_based':
        assignedUserId = await this.skillBasedAssign(taskId, tenantId);
        break;
      case 'ai_suggestion':
        const suggestion = await this.getAISuggestion(taskId, tenantId);
        assignedUserId = suggestion?.userId || null;
        break;
      case 'manual':
        assignedUserId = preferredUserId || null;
        break;
    }

    if (assignedUserId) {
      await db.query(
        `UPDATE autopilot_tasks
         SET assigned_to = $1,
             assigned_by = $2,
             assignment_method = $3,
             auto_assigned = $4,
             updated_at = NOW()
         WHERE id = $5`,
        [
          assignedUserId,
          assignedBy,
          method,
          method === 'auto' || method === 'round_robin' || method === 'skill_based',
          taskId,
        ]
      );

      // Log assignment
      await this.logAssignment(taskId, assignedUserId, method, assignedBy);
    }

    return assignedUserId;
  }

  /**
   * Auto-assign based on workload and availability
   */
  private async autoAssign(taskId: string, tenantId: TenantId): Promise<string | null> {
    // Get task details
    const taskResult = await db.query<{
      priority: string;
      task_type: string;
    }>(`SELECT priority, task_type FROM autopilot_tasks WHERE id = $1`, [taskId]);

    if (taskResult.rows.length === 0) return null;

    // Find available staff with lowest workload
    const staffResult = await db.query<{
      user_id: string;
      current_tasks: number;
      max_concurrent_tasks: number;
    }>(
      `SELECT 
         as.user_id,
         COUNT(at.id) as current_tasks,
         as.max_concurrent_tasks
       FROM accountant_staff as
       LEFT JOIN autopilot_tasks at ON at.assigned_to = as.user_id 
         AND at.status IN ('pending', 'in_progress')
       WHERE as.firm_id IN (
         SELECT firm_id FROM firm_clients WHERE client_tenant_id = $1 AND is_active = true
       )
         AND as.is_active = true
       GROUP BY as.user_id, as.max_concurrent_tasks
       HAVING COUNT(at.id) < as.max_concurrent_tasks
       ORDER BY COUNT(at.id) ASC
       LIMIT 1`,
      [tenantId]
    );

    const staff = staffResult.rows[0];
    if (!staff) return null;
    return staff.user_id;
  }

  /**
   * Round-robin assignment
   */
  private async roundRobinAssign(tenantId: TenantId): Promise<string | null> {
    // Get staff who have been assigned tasks recently, order by last assignment
    const staffResult = await db.query<{
      user_id: string;
      last_assignment: string | null;
    }>(
      `SELECT 
         as.user_id,
         MAX(at.updated_at) as last_assignment
       FROM accountant_staff as
       LEFT JOIN autopilot_tasks at ON at.assigned_to = as.user_id
       WHERE as.firm_id IN (
         SELECT firm_id FROM firm_clients WHERE client_tenant_id = $1 AND is_active = true
       )
         AND as.is_active = true
       GROUP BY as.user_id
       ORDER BY MAX(at.updated_at) NULLS FIRST
       LIMIT 1`,
      [tenantId]
    );

    const staff = staffResult.rows[0];
    if (!staff) return null;
    return staff.user_id;
  }

  /**
   * Skill-based assignment
   */
  private async skillBasedAssign(taskId: string, tenantId: TenantId): Promise<string | null> {
    // Get task type
    const taskResult = await db.query<{
      task_type: string;
    }>(`SELECT task_type FROM autopilot_tasks WHERE id = $1`, [taskId]);

    const taskRow = taskResult.rows[0];
    if (!taskRow) return null;
    const taskType = taskRow.task_type;

    // Find staff with matching skills
    const staffResult = await db.query<{
      user_id: string;
      skill_match: number;
    }>(
      `SELECT 
         as.user_id,
         CASE 
           WHEN $2 = ANY(as.skill_tags) THEN 1
           ELSE 0
         END as skill_match
       FROM accountant_staff as
       WHERE as.firm_id IN (
         SELECT firm_id FROM firm_clients WHERE client_tenant_id = $1 AND is_active = true
       )
         AND as.is_active = true
       ORDER BY skill_match DESC, as.tasks_completed DESC
       LIMIT 1`,
      [tenantId, taskType]
    );

    const staff = staffResult.rows[0];
    if (!staff) return null;
    return staff.user_id;
  }

  /**
   * Get AI suggestion for assignment
   */
  async getAISuggestion(taskId: string, tenantId: TenantId): Promise<AssignmentSuggestion | null> {
    // Get task details
    const taskResult = await db.query<{
      task_type: string;
      priority: string;
      title: string;
    }>(`SELECT task_type, priority, title FROM autopilot_tasks WHERE id = $1`, [taskId]);

    const task = taskResult.rows[0];
    if (!task) return null;

    // Get staff with performance metrics
    const staffResult = await db.query<{
      user_id: string;
      user_name: string;
      role: string;
      tasks_completed: number;
      average_completion_time: number | null;
      sla_adherence_rate: number | null;
      skill_tags: string[];
      current_tasks: number;
    }>(
      `SELECT 
         as.user_id,
         u.name as user_name,
         as.role,
         as.tasks_completed,
         as.average_completion_time,
         as.sla_adherence_rate,
         as.skill_tags,
         COUNT(at.id) as current_tasks
       FROM accountant_staff as
       JOIN users u ON u.id = as.user_id
       LEFT JOIN autopilot_tasks at ON at.assigned_to = as.user_id 
         AND at.status IN ('pending', 'in_progress')
       WHERE as.firm_id IN (
         SELECT firm_id FROM firm_clients WHERE client_tenant_id = $1 AND is_active = true
       )
         AND as.is_active = true
       GROUP BY as.user_id, u.name, as.role, as.tasks_completed, 
                as.average_completion_time, as.sla_adherence_rate, as.skill_tags
       ORDER BY 
         CASE WHEN $2 = ANY(as.skill_tags) THEN 1 ELSE 0 END DESC,
         as.sla_adherence_rate DESC NULLS LAST,
         current_tasks ASC
       LIMIT 1`,
      [tenantId, task.task_type]
    );

    const staff = staffResult.rows[0];
    if (!staff) return null;
    const reasons: string[] = [];

    if (staff.skill_tags.includes(task.task_type)) {
      reasons.push('Has relevant skills');
    }
    if (staff.sla_adherence_rate && staff.sla_adherence_rate > 0.9) {
      reasons.push('High SLA adherence');
    }
    if (staff.current_tasks < 5) {
      reasons.push('Low current workload');
    }

    return {
      userId: staff.user_id,
      userName: staff.user_name,
      role: staff.role,
      confidence: reasons.length > 0 ? 0.8 : 0.5,
      reasons,
    };
  }

  /**
   * Log assignment action
   */
  private async logAssignment(
    taskId: string,
    assignedTo: string,
    method: AssignmentMethod,
    assignedBy: UserId
  ): Promise<void> {
    await db.query(
      `INSERT INTO task_execution_history (
        task_id, action_type, action_by, action_method, previous_status, new_status,
        changes, reasoning
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        taskId,
        'assigned',
        assignedBy,
        method === 'auto' ? 'ai_autonomous' : 'human',
        'pending',
        'pending',
        JSON.stringify({ assignedTo, method }),
        `Task assigned using ${method} method`,
      ]
    );
  }
}

export const taskAssignmentService = new TaskAssignmentService();
