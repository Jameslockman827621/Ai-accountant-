import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('backup-service');

export interface BackupRestoreLog {
  id: string;
  backupType: 'full' | 'incremental' | 'differential';
  serviceName: string;
  tenantId?: TenantId;
  backupStartedAt: Date;
  backupCompletedAt?: Date;
  backupStatus: 'in_progress' | 'completed' | 'failed';
  backupSizeBytes?: number;
  backupLocation?: string;
  backupEncrypted: boolean;
  restoreRequestedAt?: Date;
  restoreCompletedAt?: Date;
  restoreStatus?: string;
  restoreToPoint?: Date;
  restoredBy?: UserId;
  retentionUntil?: Date;
  deletedAt?: Date;
  verifiedAt?: Date;
  verificationStatus?: string;
  verificationNotes?: string;
  metadata?: Record<string, unknown>;
}

export class BackupRestoreService {
  async startBackup(
    backupType: BackupRestoreLog['backupType'],
    serviceName: string,
    options: {
      tenantId?: TenantId;
      backupEncrypted?: boolean;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<BackupRestoreLog> {
    const id = randomUUID();

    await db.query(
      `INSERT INTO backup_restore_logs (
        id, backup_type, service_name, tenant_id, backup_started_at,
        backup_status, backup_encrypted, metadata
      ) VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7::jsonb)`,
      [
        id,
        backupType,
        serviceName,
        options.tenantId || null,
        'in_progress',
        options.backupEncrypted !== undefined ? options.backupEncrypted : true,
        options.metadata ? JSON.stringify(options.metadata) : null,
      ]
    );

    logger.info('Backup started', { id, backupType, serviceName });
    return this.getBackupLog(id);
  }

  async completeBackup(
    id: string,
    options: {
      backupSizeBytes?: number;
      backupLocation?: string;
      retentionUntil?: Date;
    } = {}
  ): Promise<BackupRestoreLog> {
    await db.query(
      `UPDATE backup_restore_logs SET
        backup_completed_at = NOW(),
        backup_status = 'completed',
        backup_size_bytes = COALESCE($1, backup_size_bytes),
        backup_location = COALESCE($2, backup_location),
        retention_until = COALESCE($3, retention_until)
      WHERE id = $4`,
      [options.backupSizeBytes || null, options.backupLocation || null, options.retentionUntil || null, id]
    );

    logger.info('Backup completed', { id });
    return this.getBackupLog(id);
  }

  async failBackup(id: string, errorMessage?: string): Promise<BackupRestoreLog> {
    await db.query(
      `UPDATE backup_restore_logs SET
        backup_completed_at = NOW(),
        backup_status = 'failed'
      WHERE id = $1`,
      [id]
    );

    logger.error('Backup failed', { id, errorMessage });
    return this.getBackupLog(id);
  }

  async requestRestore(
    backupId: string,
    restoreToPoint: Date,
    restoredBy: UserId,
    options: {
      restoreStatus?: string;
    } = {}
  ): Promise<BackupRestoreLog> {
    await db.query(
      `UPDATE backup_restore_logs SET
        restore_requested_at = NOW(),
        restore_to_point = $1,
        restored_by = $2,
        restore_status = COALESCE($3, 'requested')
      WHERE id = $4`,
      [restoreToPoint, restoredBy, options.restoreStatus || null, backupId]
    );

    logger.info('Restore requested', { backupId, restoreToPoint, restoredBy });
    return this.getBackupLog(backupId);
  }

  async completeRestore(
    backupId: string,
    options: {
      restoreStatus?: string;
      verificationStatus?: string;
      verificationNotes?: string;
    } = {}
  ): Promise<BackupRestoreLog> {
    const updates: string[] = ['restore_completed_at = NOW()'];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.restoreStatus) {
      updates.push(`restore_status = $${paramIndex++}`);
      params.push(options.restoreStatus);
    }
    if (options.verificationStatus) {
      updates.push(`verification_status = $${paramIndex++}, verified_at = NOW()`);
      params.push(options.verificationStatus);
    }
    if (options.verificationNotes) {
      updates.push(`verification_notes = $${paramIndex++}`);
      params.push(options.verificationNotes);
    }

    params.push(backupId);
    await db.query(`UPDATE backup_restore_logs SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);

    logger.info('Restore completed', { backupId });
    return this.getBackupLog(backupId);
  }

  async getBackupLog(id: string): Promise<BackupRestoreLog> {
    const result = await db.query<{
      id: string;
      backup_type: string;
      service_name: string;
      tenant_id: string | null;
      backup_started_at: Date;
      backup_completed_at: Date | null;
      backup_status: string;
      backup_size_bytes: number | null;
      backup_location: string | null;
      backup_encrypted: boolean;
      restore_requested_at: Date | null;
      restore_completed_at: Date | null;
      restore_status: string | null;
      restore_to_point: Date | null;
      restored_by: string | null;
      retention_until: Date | null;
      deleted_at: Date | null;
      verified_at: Date | null;
      verification_status: string | null;
      verification_notes: string | null;
      metadata: unknown;
    }>('SELECT * FROM backup_restore_logs WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      throw new Error(`Backup log not found: ${id}`);
    }

    const row = result.rows[0];
    return {
      id: row.id,
      backupType: row.backup_type as BackupRestoreLog['backupType'],
      serviceName: row.service_name,
      tenantId: row.tenant_id as TenantId | undefined,
      backupStartedAt: row.backup_started_at,
      backupCompletedAt: row.backup_completed_at || undefined,
      backupStatus: row.backup_status as BackupRestoreLog['backupStatus'],
      backupSizeBytes: row.backup_size_bytes || undefined,
      backupLocation: row.backup_location || undefined,
      backupEncrypted: row.backup_encrypted,
      restoreRequestedAt: row.restore_requested_at || undefined,
      restoreCompletedAt: row.restore_completed_at || undefined,
      restoreStatus: row.restore_status || undefined,
      restoreToPoint: row.restore_to_point || undefined,
      restoredBy: row.restored_by as UserId | undefined,
      retentionUntil: row.retention_until || undefined,
      deletedAt: row.deleted_at || undefined,
      verifiedAt: row.verified_at || undefined,
      verificationStatus: row.verification_status || undefined,
      verificationNotes: row.verification_notes || undefined,
      metadata: row.metadata as Record<string, unknown> | undefined,
    };
  }

  async getBackupLogs(filters: {
    serviceName?: string;
    tenantId?: TenantId;
    backupStatus?: BackupRestoreLog['backupStatus'];
    limit?: number;
    offset?: number;
  } = {}): Promise<{ logs: BackupRestoreLog[]; total: number }> {
    let query = 'SELECT * FROM backup_restore_logs WHERE 1=1';
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.serviceName) {
      query += ` AND service_name = $${paramIndex++}`;
      params.push(filters.serviceName);
    }
    if (filters.tenantId) {
      query += ` AND tenant_id = $${paramIndex++}`;
      params.push(filters.tenantId);
    }
    if (filters.backupStatus) {
      query += ` AND backup_status = $${paramIndex++}`;
      params.push(filters.backupStatus);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await db.query<{ count: string }>(countQuery, params);
    const total = parseInt(countResult.rows[0].count, 10);

    query += ' ORDER BY backup_started_at DESC';
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
      backup_type: string;
      service_name: string;
      tenant_id: string | null;
      backup_started_at: Date;
      backup_completed_at: Date | null;
      backup_status: string;
      backup_size_bytes: number | null;
      backup_location: string | null;
      backup_encrypted: boolean;
      restore_requested_at: Date | null;
      restore_completed_at: Date | null;
      restore_status: string | null;
      restore_to_point: Date | null;
      restored_by: string | null;
      retention_until: Date | null;
      deleted_at: Date | null;
      verified_at: Date | null;
      verification_status: string | null;
      verification_notes: string | null;
      metadata: unknown;
    }>(query, params);

    return {
      logs: result.rows.map((row) => ({
        id: row.id,
        backupType: row.backup_type as BackupRestoreLog['backupType'],
        serviceName: row.service_name,
        tenantId: row.tenant_id as TenantId | undefined,
        backupStartedAt: row.backup_started_at,
        backupCompletedAt: row.backup_completed_at || undefined,
        backupStatus: row.backup_status as BackupRestoreLog['backupStatus'],
        backupSizeBytes: row.backup_size_bytes || undefined,
        backupLocation: row.backup_location || undefined,
        backupEncrypted: row.backup_encrypted,
        restoreRequestedAt: row.restore_requested_at || undefined,
        restoreCompletedAt: row.restore_completed_at || undefined,
        restoreStatus: row.restore_status || undefined,
        restoreToPoint: row.restore_to_point || undefined,
        restoredBy: row.restored_by as UserId | undefined,
        retentionUntil: row.retention_until || undefined,
        deletedAt: row.deleted_at || undefined,
        verifiedAt: row.verified_at || undefined,
        verificationStatus: row.verification_status || undefined,
        verificationNotes: row.verification_notes || undefined,
        metadata: row.metadata as Record<string, unknown> | undefined,
      })),
      total,
    };
  }
}

export const backupRestoreService = new BackupRestoreService();
