import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('security-service');

export interface SecurityEvent {
  id: string;
  tenantId?: TenantId;
  userId?: UserId;
  eventType: 'login_failure' | 'unauthorized_access' | 'data_breach' | 'policy_violation' | 'suspicious_activity' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  eventTimestamp: Date;
  sourceIp?: string;
  userAgent?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  description?: string;
  rawEvent?: Record<string, unknown>;
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  assignedTo?: string;
  resolvedAt?: Date;
  resolutionNotes?: string;
  reportedToAuthorities: boolean;
  reportedAt?: Date;
  metadata?: Record<string, unknown>;
}

export class SecurityEventService {
  async recordEvent(
    eventType: SecurityEvent['eventType'],
    severity: SecurityEvent['severity'],
    options: {
      tenantId?: TenantId;
      userId?: UserId;
      sourceIp?: string;
      userAgent?: string;
      resourceType?: string;
      resourceId?: string;
      action?: string;
      description?: string;
      rawEvent?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<SecurityEvent> {
    const id = randomUUID();

    await db.query(
      `INSERT INTO security_events (
        id, tenant_id, user_id, event_type, severity, event_timestamp,
        source_ip, user_agent, resource_type, resource_id, action,
        description, raw_event, status, metadata
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14::jsonb)`,
      [
        id,
        options.tenantId || null,
        options.userId || null,
        eventType,
        severity,
        options.sourceIp || null,
        options.userAgent || null,
        options.resourceType || null,
        options.resourceId || null,
        options.action || null,
        options.description || null,
        options.rawEvent ? JSON.stringify(options.rawEvent) : null,
        'open',
        options.metadata ? JSON.stringify(options.metadata) : null,
      ]
    );

    logger.warn('Security event recorded', { id, eventType, severity });
    return this.getEvent(id);
  }

  async getEvent(id: string): Promise<SecurityEvent> {
    const result = await db.query<{
      id: string;
      tenant_id: string | null;
      user_id: string | null;
      event_type: string;
      severity: string;
      event_timestamp: Date;
      source_ip: string | null;
      user_agent: string | null;
      resource_type: string | null;
      resource_id: string | null;
      action: string | null;
      description: string | null;
      raw_event: unknown;
      status: string;
      assigned_to: string | null;
      resolved_at: Date | null;
      resolution_notes: string | null;
      reported_to_authorities: boolean;
      reported_at: Date | null;
      metadata: unknown;
    }>('SELECT * FROM security_events WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`Security event not found: ${id}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      tenantId: row.tenant_id || undefined,
      userId: row.user_id || undefined,
      eventType: row.event_type as SecurityEvent['eventType'],
      severity: row.severity as SecurityEvent['severity'],
      eventTimestamp: row.event_timestamp,
      sourceIp: row.source_ip || undefined,
      userAgent: row.user_agent || undefined,
      resourceType: row.resource_type || undefined,
      resourceId: row.resource_id || undefined,
      action: row.action || undefined,
      description: row.description || undefined,
      rawEvent: row.raw_event as Record<string, unknown> | undefined,
      status: row.status as SecurityEvent['status'],
      assignedTo: row.assigned_to || undefined,
      resolvedAt: row.resolved_at || undefined,
      resolutionNotes: row.resolution_notes || undefined,
      reportedToAuthorities: row.reported_to_authorities,
      reportedAt: row.reported_at || undefined,
      metadata: row.metadata as Record<string, unknown> | undefined,
    };
  }

  async updateEventStatus(
    id: string,
    status: SecurityEvent['status'],
    options: {
      assignedTo?: string;
      resolutionNotes?: string;
      reportedToAuthorities?: boolean;
    } = {}
  ): Promise<SecurityEvent> {
    const updates: string[] = ['status = $1'];
    const params: unknown[] = [status];
    let paramIndex = 2;

    if (status === 'resolved' || status === 'false_positive') {
      updates.push(`resolved_at = NOW()`);
      if (options.resolutionNotes) {
        updates.push(`resolution_notes = $${paramIndex++}`);
        params.push(options.resolutionNotes);
      }
    }

    if (options.assignedTo) {
      updates.push(`assigned_to = $${paramIndex++}`);
      params.push(options.assignedTo);
    }

    if (options.reportedToAuthorities) {
      updates.push(`reported_to_authorities = true, reported_at = NOW()`);
    }

    params.push(id);
    await db.query(`UPDATE security_events SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);

    logger.info('Security event status updated', { id, status });
    return this.getEvent(id);
  }

  async getEvents(filters: {
    tenantId?: TenantId;
    eventType?: SecurityEvent['eventType'];
    severity?: SecurityEvent['severity'];
    status?: SecurityEvent['status'];
    limit?: number;
    offset?: number;
  } = {}): Promise<{ events: SecurityEvent[]; total: number }> {
    let query = 'SELECT * FROM security_events WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.tenantId) {
      query += ` AND tenant_id = $${paramIndex++}`;
      params.push(filters.tenantId);
    }
    if (filters.eventType) {
      query += ` AND event_type = $${paramIndex++}`;
      params.push(filters.eventType);
    }
    if (filters.severity) {
      query += ` AND severity = $${paramIndex++}`;
      params.push(filters.severity);
    }
    if (filters.status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(filters.status);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ' ORDER BY event_timestamp DESC';
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
      tenant_id: string | null;
      user_id: string | null;
      event_type: string;
      severity: string;
      event_timestamp: Date;
      source_ip: string | null;
      user_agent: string | null;
      resource_type: string | null;
      resource_id: string | null;
      action: string | null;
      description: string | null;
      raw_event: unknown;
      status: string;
      assigned_to: string | null;
      resolved_at: Date | null;
      resolution_notes: string | null;
      reported_to_authorities: boolean;
      reported_at: Date | null;
      metadata: unknown;
    }>(query, params);

    return {
      events: result.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id || undefined,
        userId: row.user_id || undefined,
        eventType: row.event_type as SecurityEvent['eventType'],
        severity: row.severity as SecurityEvent['severity'],
        eventTimestamp: row.event_timestamp,
        sourceIp: row.source_ip || undefined,
        userAgent: row.user_agent || undefined,
        resourceType: row.resource_type || undefined,
        resourceId: row.resource_id || undefined,
        action: row.action || undefined,
        description: row.description || undefined,
        rawEvent: row.raw_event as Record<string, unknown> | undefined,
        status: row.status as SecurityEvent['status'],
        assignedTo: row.assigned_to || undefined,
        resolvedAt: row.resolved_at || undefined,
        resolutionNotes: row.resolution_notes || undefined,
        reportedToAuthorities: row.reported_to_authorities,
        reportedAt: row.reported_at || undefined,
        metadata: row.metadata as Record<string, unknown> | undefined,
      })),
      total,
    };
  }
}

export const securityEventService = new SecurityEventService();
