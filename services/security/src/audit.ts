/**
 * Enhanced Audit Logging Service
 * Comprehensive audit trail for compliance and security
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { db } from '@ai-accountant/database';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('audit');

export type AuditAction =
  | 'user_login'
  | 'user_logout'
  | 'user_created'
  | 'user_updated'
  | 'user_deleted'
  | 'document_uploaded'
  | 'document_deleted'
  | 'ledger_entry_created'
  | 'ledger_entry_updated'
  | 'ledger_entry_deleted'
  | 'filing_created'
  | 'filing_submitted'
  | 'filing_approved'
  | 'filing_rejected'
  | 'config_changed'
  | 'rulepack_edited'
  | 'rulepack_activated'
  | 'assistant_action'
  | 'assistant_action_approved'
  | 'assistant_action_rejected'
  | 'data_exported'
  | 'permission_granted'
  | 'permission_revoked'
  | 'secret_rotated'
  | 'backup_created'
  | 'backup_restored';

export interface AuditLogEntry {
  tenantId: TenantId;
  userId?: UserId;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  changes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

class AuditService {
  /**
   * Log an audit event
   */
  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await db.query(
        `INSERT INTO audit_logs (
          tenant_id, user_id, action, resource_type, resource_id,
          changes, metadata, ip_address, user_agent, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, NOW())`,
        [
          entry.tenantId,
          entry.userId || null,
          entry.action,
          entry.resourceType,
          entry.resourceId,
          JSON.stringify(entry.changes || {}),
          JSON.stringify(entry.metadata || {}),
          entry.ipAddress || null,
          entry.userAgent || null,
        ]
      );
    } catch (error) {
      logger.error('Failed to write audit log', error);
      // Don't throw - audit logging should not break the application
    }
  }

  /**
   * Log configuration change
   */
  async logConfigChange(
    tenantId: TenantId,
    userId: UserId,
    configKey: string,
    oldValue: unknown,
    newValue: unknown,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      tenantId,
      userId,
      action: 'config_changed',
      resourceType: 'configuration',
      resourceId: configKey,
      changes: {
        oldValue,
        newValue,
      },
      metadata,
    });
  }

  /**
   * Log rulepack edit
   */
  async logRulepackEdit(
    tenantId: TenantId,
    userId: UserId,
    rulepackId: string,
    changes: Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      tenantId,
      userId,
      action: 'rulepack_edited',
      resourceType: 'rulepack',
      resourceId: rulepackId,
      changes,
      metadata,
    });
  }

  /**
   * Log assistant action
   */
  async logAssistantAction(
    tenantId: TenantId,
    userId: UserId,
    actionId: string,
    toolName: string,
    args: Record<string, unknown>,
    result?: unknown,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      tenantId,
      userId,
      action: 'assistant_action',
      resourceType: 'assistant_action',
      resourceId: actionId,
      changes: {
        toolName,
        args,
        result,
      },
      metadata,
    });
  }

  /**
   * Log data export
   */
  async logDataExport(
    tenantId: TenantId,
    userId: UserId,
    exportType: string,
    recordCount: number,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      tenantId,
      userId,
      action: 'data_exported',
      resourceType: 'export',
      resourceId: `${exportType}-${Date.now()}`,
      changes: {
        exportType,
        recordCount,
      },
      metadata,
    });
  }

  /**
   * Get audit logs for a tenant
   */
  async getAuditLogs(
    tenantId: TenantId,
    filters?: {
      userId?: UserId;
      action?: AuditAction;
      resourceType?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    }
  ): Promise<Array<{
    id: string;
    userId: string | null;
    action: string;
    resourceType: string;
    resourceId: string;
    changes: unknown;
    metadata: unknown;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
  }>> {
    let query = `SELECT * FROM audit_logs WHERE tenant_id = $1`;
    const params: unknown[] = [tenantId];
    let paramIndex = 2;

    if (filters?.userId) {
      query += ` AND user_id = $${paramIndex++}`;
      params.push(filters.userId);
    }

    if (filters?.action) {
      query += ` AND action = $${paramIndex++}`;
      params.push(filters.action);
    }

    if (filters?.resourceType) {
      query += ` AND resource_type = $${paramIndex++}`;
      params.push(filters.resourceType);
    }

    if (filters?.startDate) {
      query += ` AND created_at >= $${paramIndex++}`;
      params.push(filters.startDate);
    }

    if (filters?.endDate) {
      query += ` AND created_at <= $${paramIndex++}`;
      params.push(filters.endDate);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++}`;
    params.push(filters?.limit || 100);

    const result = await db.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      changes: row.changes,
      metadata: row.metadata,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    }));
  }
}

export const auditService = new AuditService();
