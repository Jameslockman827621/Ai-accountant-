/**
 * Backup and Disaster Recovery Service
 * Automated backups with restore capabilities
 */

import { createLogger } from '@ai-accountant/shared-utils';
import { exec } from 'child_process';
import { promisify } from 'util';
import { db } from '@ai-accountant/database';

const execAsync = promisify(exec);
const logger = createLogger('backup');

export interface BackupConfig {
  rpo: number; // Recovery Point Objective in minutes (default: 15)
  retentionDays: number; // How long to keep backups (default: 30)
  s3Bucket?: string; // S3 bucket for backup storage
  crossRegionReplication: boolean; // Enable cross-region replication
}

const DEFAULT_CONFIG: BackupConfig = {
  rpo: 15,
  retentionDays: 30,
  crossRegionReplication: true,
};

class BackupService {
  private config: BackupConfig;

  constructor(config?: Partial<BackupConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create database backup
   */
  async createBackup(tenantId?: string): Promise<{
    backupId: string;
    location: string;
    size: number;
    timestamp: Date;
  }> {
    const backupId = `backup-${Date.now()}`;
    const timestamp = new Date();

    try {
      // Create backup directory
      const backupDir = `/tmp/backups/${backupId}`;
      await execAsync(`mkdir -p ${backupDir}`);

      // Create PostgreSQL backup using pg_dump
      const dbUrl = process.env.DATABASE_URL || '';
      const backupFile = `${backupDir}/database.sql`;

      await execAsync(`pg_dump "${dbUrl}" > ${backupFile}`);

      // Get backup size
      const { stdout: sizeOutput } = await execAsync(`du -b ${backupFile} | cut -f1`);
      const size = parseInt(sizeOutput.trim(), 10);

      // Compress backup
      await execAsync(`gzip ${backupFile}`);

      // Upload to S3 if configured
      let location = backupFile + '.gz';
      if (this.config.s3Bucket) {
        const s3Key = `backups/${backupId}.sql.gz`;
        await execAsync(
          `aws s3 cp ${backupFile}.gz s3://${this.config.s3Bucket}/${s3Key} --storage-class GLACIER`
        );
        location = `s3://${this.config.s3Bucket}/${s3Key}`;

        // Enable cross-region replication if configured
        if (this.config.crossRegionReplication) {
          // This would be configured at bucket level in AWS
          logger.info('Cross-region replication enabled for backup', { backupId, s3Key });
        }
      }

      // Log backup creation
      await db.query(
        `INSERT INTO backup_logs (
          backup_id, tenant_id, location, size_bytes, status, created_at
        ) VALUES ($1, $2, $3, $4, 'completed', NOW())`,
        [backupId, tenantId || null, location, size]
      );

      logger.info('Backup created successfully', { backupId, location, size });

      return {
        backupId,
        location,
        size,
        timestamp,
      };
    } catch (error) {
      logger.error('Backup creation failed', error);

      // Log failure
      await db.query(
        `INSERT INTO backup_logs (
          backup_id, tenant_id, status, error_message, created_at
        ) VALUES ($1, $2, 'failed', $3, NOW())`,
        [backupId, tenantId || null, error instanceof Error ? error.message : String(error)]
      );

      throw error;
    }
  }

  /**
   * Restore from backup
   */
  async restoreBackup(backupId: string, targetDatabase?: string): Promise<void> {
    try {
      // Get backup location
      const result = await db.query<{ location: string }>(
        `SELECT location FROM backup_logs WHERE backup_id = $1 AND status = 'completed'`,
        [backupId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      const location = result.rows[0].location;
      let backupFile: string;

      // Download from S3 if needed
      if (location.startsWith('s3://')) {
        const localFile = `/tmp/restore-${backupId}.sql.gz`;
        const s3Path = location.replace('s3://', '');
        const [bucket, ...keyParts] = s3Path.split('/');
        const key = keyParts.join('/');

        await execAsync(`aws s3 cp s3://${bucket}/${key} ${localFile}`);
        backupFile = localFile;
      } else {
        backupFile = location;
      }

      // Decompress if needed
      if (backupFile.endsWith('.gz')) {
        await execAsync(`gunzip ${backupFile}`);
        backupFile = backupFile.replace('.gz', '');
      }

      // Restore database
      const dbUrl = targetDatabase || process.env.DATABASE_URL || '';
      await execAsync(`psql "${dbUrl}" < ${backupFile}`);

      // Log restoration
      await db.query(
        `INSERT INTO restore_logs (
          backup_id, target_database, status, restored_at
        ) VALUES ($1, $2, 'completed', NOW())`,
        [backupId, targetDatabase || 'default']
      );

      logger.info('Backup restored successfully', { backupId, targetDatabase });
    } catch (error) {
      logger.error('Backup restoration failed', error);

      // Log failure
      await db.query(
        `INSERT INTO restore_logs (
          backup_id, target_database, status, error_message, restored_at
        ) VALUES ($1, $2, 'failed', $3, NOW())`,
        [
          backupId,
          targetDatabase || 'default',
          error instanceof Error ? error.message : String(error),
        ]
      );

      throw error;
    }
  }

  /**
   * Clean up old backups
   */
  async cleanupOldBackups(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    try {
      // Get old backups
      const result = await db.query<{ backup_id: string; location: string }>(
        `SELECT backup_id, location FROM backup_logs
         WHERE created_at < $1 AND status = 'completed'`,
        [cutoffDate]
      );

      let deletedCount = 0;

      for (const row of result.rows) {
        try {
          // Delete from S3 if applicable
          if (row.location.startsWith('s3://')) {
            const s3Path = row.location.replace('s3://', '');
            const [bucket, ...keyParts] = s3Path.split('/');
            const key = keyParts.join('/');
            await execAsync(`aws s3 rm s3://${bucket}/${key}`);
          } else {
            // Delete local file
            await execAsync(`rm -f ${row.location}`);
          }

          // Mark as deleted in database
          await db.query(`UPDATE backup_logs SET status = 'deleted' WHERE backup_id = $1`, [
            row.backup_id,
          ]);

          deletedCount++;
        } catch (error) {
          logger.error(`Failed to delete backup ${row.backup_id}`, error);
        }
      }

      logger.info('Backup cleanup completed', { deletedCount });
      return deletedCount;
    } catch (error) {
      logger.error('Backup cleanup failed', error);
      throw error;
    }
  }

  /**
   * Schedule automated backups
   */
  startScheduledBackups() {
    const intervalMs = this.config.rpo * 60 * 1000; // Convert minutes to milliseconds

    setInterval(async () => {
      try {
        await this.createBackup();
      } catch (error) {
        logger.error('Scheduled backup failed', error);
      }
    }, intervalMs);

    logger.info('Scheduled backups started', {
      intervalMinutes: this.config.rpo,
      retentionDays: this.config.retentionDays,
    });
  }
}

export const backupService = new BackupService();
