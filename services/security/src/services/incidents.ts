import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('security-service');

export interface Incident {
  id: string;
  incidentNumber: string;
  severity: 'sev1' | 'sev2' | 'sev3' | 'sev4';
  incidentType: 'security' | 'availability' | 'data_loss' | 'performance' | 'other';
  status: 'open' | 'investigating' | 'mitigated' | 'resolved' | 'postmortem';
  detectedAt: Date;
  reportedAt?: Date;
  acknowledgedAt?: Date;
  mitigatedAt?: Date;
  resolvedAt?: Date;
  detectedBy?: UserId;
  assignedTo?: UserId;
  onCallRotation?: string;
  title: string;
  description?: string;
  affectedServices?: string[];
  affectedTenants?: TenantId[];
  customerImpact?: string;
  mttdMinutes?: number;
  mttrMinutes?: number;
  mttaMinutes?: number;
  rootCause?: string;
  resolutionSteps?: string;
  postmortemDocumentUrl?: string;
  lessonsLearned?: string;
  actionItems?: Array<{ id: string; description: string; assignedTo?: string; dueDate?: Date; status: string }>;
  metadata?: Record<string, unknown>;
}

export class IncidentService {
  private generateIncidentNumber(): string {
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `INC-${year}${month}-${random}`;
  }

  async createIncident(
    severity: Incident['severity'],
    incidentType: Incident['incidentType'],
    title: string,
    options: {
      description?: string;
      detectedBy?: UserId;
      affectedServices?: string[];
      affectedTenants?: TenantId[];
      customerImpact?: string;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<Incident> {
    const id = randomUUID();
    const incidentNumber = this.generateIncidentNumber();

    await db.query(
      `INSERT INTO incidents (
        id, incident_number, severity, incident_type, status,
        detected_at, title, description, detected_by,
        affected_services, affected_tenants, customer_impact, metadata
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10, $11, $12::jsonb)`,
      [
        id,
        incidentNumber,
        severity,
        incidentType,
        'open',
        title,
        options.description || null,
        options.detectedBy || null,
        options.affectedServices || null,
        options.affectedTenants || null,
        options.customerImpact || null,
        options.metadata ? JSON.stringify(options.metadata) : null,
      ]
    );

    logger.error('Incident created', { id, incidentNumber, severity, incidentType });
    return this.getIncident(id);
  }

  async getIncident(id: string): Promise<Incident> {
    const result = await db.query<{
      id: string;
      incident_number: string;
      severity: string;
      incident_type: string;
      status: string;
      detected_at: Date;
      reported_at: Date | null;
      acknowledged_at: Date | null;
      mitigated_at: Date | null;
      resolved_at: Date | null;
      detected_by: string | null;
      assigned_to: string | null;
      on_call_rotation: string | null;
      title: string;
      description: string | null;
      affected_services: string[] | null;
      affected_tenants: string[] | null;
      customer_impact: string | null;
      mttd_minutes: number | null;
      mttr_minutes: number | null;
      mtta_minutes: number | null;
      root_cause: string | null;
      resolution_steps: string | null;
      postmortem_document_url: string | null;
      lessons_learned: string | null;
      action_items: unknown;
      metadata: unknown;
    }>('SELECT * FROM incidents WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`Incident not found: ${id}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      incidentNumber: row.incident_number,
      severity: row.severity as Incident['severity'],
      incidentType: row.incident_type as Incident['incidentType'],
      status: row.status as Incident['status'],
      detectedAt: row.detected_at,
      reportedAt: row.reported_at || undefined,
      acknowledgedAt: row.acknowledged_at || undefined,
      mitigatedAt: row.mitigated_at || undefined,
      resolvedAt: row.resolved_at || undefined,
      detectedBy: row.detected_by || undefined,
      assignedTo: row.assigned_to || undefined,
      onCallRotation: row.on_call_rotation || undefined,
      title: row.title,
      description: row.description || undefined,
      affectedServices: row.affected_services || undefined,
      affectedTenants: row.affected_tenants as TenantId[] | undefined,
      customerImpact: row.customer_impact || undefined,
      mttdMinutes: row.mttd_minutes || undefined,
      mttrMinutes: row.mttr_minutes || undefined,
      mttaMinutes: row.mtta_minutes || undefined,
      rootCause: row.root_cause || undefined,
      resolutionSteps: row.resolution_steps || undefined,
      postmortemDocumentUrl: row.postmortem_document_url || undefined,
      lessonsLearned: row.lessons_learned || undefined,
      actionItems: row.action_items as Incident['actionItems'],
      metadata: row.metadata as Record<string, unknown> | undefined,
    };
  }

  async updateIncidentStatus(
    id: string,
    status: Incident['status'],
    options: {
      assignedTo?: UserId;
      onCallRotation?: string;
      rootCause?: string;
      resolutionSteps?: string;
      postmortemDocumentUrl?: string;
      lessonsLearned?: string;
      actionItems?: Incident['actionItems'];
    } = {}
  ): Promise<Incident> {
    const updates: string[] = ['status = $1'];
    const params: unknown[] = [status];
    let paramIndex = 2;

    if (status === 'investigating' && !options.assignedTo) {
      // Auto-acknowledge when investigating
      updates.push(`acknowledged_at = COALESCE(acknowledged_at, NOW())`);
    } else if (status === 'mitigated') {
      updates.push(`mitigated_at = NOW()`);
    } else if (status === 'resolved' || status === 'postmortem') {
      updates.push(`resolved_at = NOW()`);
      if (options.rootCause) {
        updates.push(`root_cause = $${paramIndex++}`);
        params.push(options.rootCause);
      }
      if (options.resolutionSteps) {
        updates.push(`resolution_steps = $${paramIndex++}`);
        params.push(options.resolutionSteps);
      }
      if (options.postmortemDocumentUrl) {
        updates.push(`postmortem_document_url = $${paramIndex++}`);
        params.push(options.postmortemDocumentUrl);
      }
      if (options.lessonsLearned) {
        updates.push(`lessons_learned = $${paramIndex++}`);
        params.push(options.lessonsLearned);
      }
      if (options.actionItems) {
        updates.push(`action_items = $${paramIndex++}::jsonb`);
        params.push(JSON.stringify(options.actionItems));
      }

      // Calculate MTTR
      const incident = await this.getIncident(id);
      if (incident.detectedAt && !incident.mttrMinutes) {
        const mttrMinutes = Math.floor((new Date().getTime() - incident.detectedAt.getTime()) / (1000 * 60));
        updates.push(`mttr_minutes = $${paramIndex++}`);
        params.push(mttrMinutes);
      }
    }

    if (options.assignedTo) {
      updates.push(`assigned_to = $${paramIndex++}`);
      params.push(options.assignedTo);
    }
    if (options.onCallRotation) {
      updates.push(`on_call_rotation = $${paramIndex++}`);
      params.push(options.onCallRotation);
    }

    params.push(id);
    await db.query(`UPDATE incidents SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);

    logger.info('Incident status updated', { id, status });
    return this.getIncident(id);
  }

  async getIncidents(filters: {
    severity?: Incident['severity'];
    incidentType?: Incident['incidentType'];
    status?: Incident['status'];
    limit?: number;
    offset?: number;
  } = {}): Promise<{ incidents: Incident[]; total: number }> {
    let query = 'SELECT * FROM incidents WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.severity) {
      query += ` AND severity = $${paramIndex++}`;
      params.push(filters.severity);
    }
    if (filters.incidentType) {
      query += ` AND incident_type = $${paramIndex++}`;
      params.push(filters.incidentType);
    }
    if (filters.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ' ORDER BY detected_at DESC';
    if (filters.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }
    if (filters.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(filters.offset);
    }

    const result = await db.query<{
      id: string;
      incident_number: string;
      severity: string;
      incident_type: string;
      status: string;
      detected_at: Date;
      reported_at: Date | null;
      acknowledged_at: Date | null;
      mitigated_at: Date | null;
      resolved_at: Date | null;
      detected_by: string | null;
      assigned_to: string | null;
      on_call_rotation: string | null;
      title: string;
      description: string | null;
      affected_services: string[] | null;
      affected_tenants: string[] | null;
      customer_impact: string | null;
      mttd_minutes: number | null;
      mttr_minutes: number | null;
      mtta_minutes: number | null;
      root_cause: string | null;
      resolution_steps: string | null;
      postmortem_document_url: string | null;
      lessons_learned: string | null;
      action_items: unknown;
      metadata: unknown;
    }>(query, params);

    return {
      incidents: result.rows.map((row) => ({
        id: row.id,
        incidentNumber: row.incident_number,
        severity: row.severity as Incident['severity'],
        incidentType: row.incident_type as Incident['incidentType'],
        status: row.status as Incident['status'],
        detectedAt: row.detected_at,
        reportedAt: row.reported_at || undefined,
        acknowledgedAt: row.acknowledged_at || undefined,
        mitigatedAt: row.mitigated_at || undefined,
        resolvedAt: row.resolved_at || undefined,
        detectedBy: row.detected_by || undefined,
        assignedTo: row.assigned_to || undefined,
        onCallRotation: row.on_call_rotation || undefined,
        title: row.title,
        description: row.description || undefined,
        affectedServices: row.affected_services || undefined,
        affectedTenants: row.affected_tenants as TenantId[] | undefined,
        customerImpact: row.customer_impact || undefined,
        mttdMinutes: row.mttd_minutes || undefined,
        mttrMinutes: row.mttr_minutes || undefined,
        mttaMinutes: row.mtta_minutes || undefined,
        rootCause: row.root_cause || undefined,
        resolutionSteps: row.resolution_steps || undefined,
        postmortemDocumentUrl: row.postmortem_document_url || undefined,
        lessonsLearned: row.lessons_learned || undefined,
        actionItems: row.action_items as Incident['actionItems'],
        metadata: row.metadata as Record<string, unknown> | undefined,
      })),
      total,
    };
  }
}

export const incidentService = new IncidentService();
