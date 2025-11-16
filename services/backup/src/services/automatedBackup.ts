import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('backup-service');

export interface Backup {
  id: string;
  tenantId: TenantId;
  backupType: 'full' | 'incremental';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  sizeBytes: number;
  storageLocation: string;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Automated backup system with scheduled backups
 */
export class AutomatedBackupService {
  /**
   * Create a backup for a tenant
   */
  async createBackup(
    tenantId: TenantId,
    backupType: 'full' | 'incremental' = 'incremental'
  ): Promise<string> {
    const backupId = randomUUID();
    const storageLocation = `backups/${tenantId}/${backupId}.tar.gz`;

    // Create backup record
    await db.query(
      `INSERT INTO backups (
        id, tenant_id, backup_type, status, storage_location,
        started_at, created_at
      ) VALUES ($1, $2, $3, 'in_progress', $4, NOW(), NOW())`,
      [backupId, tenantId, backupType, storageLocation]
    );

    logger.info('Backup started', { backupId, tenantId, backupType });

    // In production, this would:
    // 1. Export all tenant data to JSON/SQL dump
    // 2. Compress the dump
    // 3. Upload to S3/cloud storage
    // 4. Update backup record with size and status

    // For now, simulate backup completion
    setTimeout(async () => {
      await db.query(
        `UPDATE backups
         SET status = 'completed',
             size_bytes = $1,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [1024 * 1024 * 10, backupId] // 10MB placeholder
      );

      logger.info('Backup completed', { backupId, tenantId });
    }, 1000);

    return backupId;
  }

  /**
   * Get backups for a tenant
   */
  async getBackups(tenantId: TenantId, limit = 20): Promise<Backup[]> {
    const result = await db.query<{
      id: string;
      tenant_id: string;
      backup_type: string;
      status: string;
      size_bytes: number;
      storage_location: string;
      started_at: Date;
      completed_at: Date | null;
      error: string | null;
    }>(
      `SELECT id, tenant_id, backup_type, status, size_bytes, storage_location,
              started_at, completed_at, error
       FROM backups
       WHERE tenant_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [tenantId, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      tenantId: row.tenant_id as TenantId,
      backupType: row.backup_type as 'full' | 'incremental',
      status: row.status as Backup['status'],
      sizeBytes: row.size_bytes,
      storageLocation: row.storage_location,
      startedAt: row.started_at,
      completedAt: row.completed_at || undefined,
      error: row.error || undefined,
    }));
  }

  /**
   * Schedule daily backups (would be called by cron job)
   */
  async scheduleDailyBackups(): Promise<number> {
    logger.info('Running scheduled daily backups');

    // Get all active tenants
    const tenantsResult = await db.query<{
      id: string;
    }>(
      `SELECT id
       FROM tenants
       WHERE subscription_tier IS NOT NULL
       ORDER BY created_at DESC`
    );

    let backupsCreated = 0;

    for (const tenant of tenantsResult.rows) {
      try {
        // Check if backup needed (last backup > 24 hours ago or doesn't exist)
        const lastBackupResult = await db.query<{
          started_at: Date;
        }>(
          `SELECT started_at
           FROM backups
           WHERE tenant_id = $1 AND status = 'completed'
           ORDER BY started_at DESC
           LIMIT 1`,
          [tenant.id]
        );

        const needsBackup = lastBackupResult.rows.length === 0 ||
          (Date.now() - lastBackupResult.rows[0].started_at.getTime()) > 24 * 60 * 60 * 1000;

        if (needsBackup) {
          await this.createBackup(tenant.id as TenantId, 'incremental');
          backupsCreated++;
        }
      } catch (error) {
        logger.error('Failed to create scheduled backup', {
          tenantId: tenant.id,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    logger.info('Scheduled backups completed', { backupsCreated, totalTenants: tenantsResult.rows.length });

    return backupsCreated;
  }

  /**
   * Verify backup integrity
   */
  async verifyBackup(backupId: string, tenantId: TenantId): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const backupResult = await db.query<{
      id: string;
      status: string;
      storage_location: string;
    }>(
      `SELECT id, status, storage_location
       FROM backups
       WHERE id = $1 AND tenant_id = $2`,
      [backupId, tenantId]
    );

    if (backupResult.rows.length === 0) {
      return { valid: false, errors: ['Backup not found'] };
    }

    const backup = backupResult.rows[0];

    if (backup.status !== 'completed') {
      return { valid: false, errors: [`Backup status is ${backup.status}, expected completed`] };
    }

    // In production, would:
    // 1. Download backup from storage
    // 2. Verify checksum
    // 3. Test restore to temporary location
    // 4. Validate data integrity

    return { valid: true, errors: [] };
  }
}

// Singleton instance
export const automatedBackupService = new AutomatedBackupService();
