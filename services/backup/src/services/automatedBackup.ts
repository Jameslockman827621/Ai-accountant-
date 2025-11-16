import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import AWS from 'aws-sdk';

const logger = createLogger('backup-service');

// S3 client for backup storage
const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
});

const BACKUP_BUCKET = process.env.S3_BACKUP_BUCKET || 'ai-accountant-backups';

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

    // Perform actual backup
    try {
      // 1. Export all tenant data to JSON
      const backupData = await exportTenantData(tenantId, backupType);

      // 2. Compress the data
      const compressedData = await compressData(JSON.stringify(backupData));

      // 3. Upload to S3
      await s3
        .putObject({
          Bucket: BACKUP_BUCKET,
          Key: storageLocation,
          Body: compressedData,
          ContentType: 'application/gzip',
          ServerSideEncryption: 'AES256',
        })
        .promise();

      const sizeBytes = compressedData.length;

      // 4. Update backup record with size and status
      await db.query(
        `UPDATE backups
         SET status = 'completed',
             size_bytes = $1,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [sizeBytes, backupId]
      );

      logger.info('Backup completed', { backupId, tenantId, sizeBytes });
    } catch (error) {
      logger.error('Backup failed', error instanceof Error ? error : new Error(String(error)), { backupId, tenantId });
      
      await db.query(
        `UPDATE backups
         SET status = 'failed',
             error = $1,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [error instanceof Error ? error.message : String(error), backupId]
      );

      throw error;
    }

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

    // Verify backup exists in storage
    try {
      await s3.headObject({
        Bucket: BACKUP_BUCKET,
        Key: backup.storage_location,
      }).promise();
    } catch (error) {
      return { valid: false, errors: ['Backup file not found in storage'] };
    }

    return { valid: true, errors: [] };
  }
}

/**
 * Export all tenant data for backup
 */
async function exportTenantData(tenantId: TenantId, backupType: 'full' | 'incremental'): Promise<Record<string, unknown>> {
  const exportData: Record<string, unknown> = {
    tenantId,
    backupType,
    exportedAt: new Date().toISOString(),
    version: '1.0',
  };

  // Export tenant info
  const tenantResult = await db.query(
    `SELECT * FROM tenants WHERE id = $1`,
    [tenantId]
  );
  exportData.tenant = tenantResult.rows[0] || null;

  // Export users
  const usersResult = await db.query(
    `SELECT id, tenant_id, email, name, role, is_active, email_verified, 
            email_verified_at, mfa_enabled, created_at, updated_at
     FROM users WHERE tenant_id = $1`,
    [tenantId]
  );
  exportData.users = usersResult.rows;

  // Export documents metadata (not files themselves)
  const documentsResult = await db.query(
    `SELECT id, tenant_id, uploaded_by, file_name, file_type, file_size,
            storage_key, document_type, status, extracted_data, confidence_score,
            quality_score, created_at, updated_at
     FROM documents WHERE tenant_id = $1`,
    [tenantId]
  );
  exportData.documents = documentsResult.rows;

  // Export ledger entries
  const ledgerResult = await db.query(
    `SELECT * FROM ledger_entries WHERE tenant_id = $1`,
    [tenantId]
  );
  exportData.ledgerEntries = ledgerResult.rows;

  // Export filings
  const filingsResult = await db.query(
    `SELECT * FROM filings WHERE tenant_id = $1`,
    [tenantId]
  );
  exportData.filings = filingsResult.rows;

  // Export chart of accounts
  const chartResult = await db.query(
    `SELECT * FROM chart_of_accounts WHERE tenant_id = $1`,
    [tenantId]
  );
  exportData.chartOfAccounts = chartResult.rows[0] || null;

  // Export bank connections metadata (not tokens)
  const bankConnectionsResult = await db.query(
    `SELECT id, tenant_id, provider, token_expires_at, last_refreshed_at,
            last_sync, last_success, last_error, item_id, provider_account_id,
            metadata, exception_count, error_count, is_active, created_at, updated_at
     FROM bank_connections WHERE tenant_id = $1`,
    [tenantId]
  );
  exportData.bankConnections = bankConnectionsResult.rows;

  // Export subscriptions
  const subscriptionsResult = await db.query(
    `SELECT * FROM subscriptions WHERE tenant_id = $1`,
    [tenantId]
  );
  exportData.subscriptions = subscriptionsResult.rows;

  return exportData;
}

/**
 * Compress data using gzip
 */
async function compressData(data: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gzip = createGzip();

    gzip.on('data', (chunk: Buffer) => chunks.push(chunk));
    gzip.on('end', () => resolve(Buffer.concat(chunks)));
    gzip.on('error', reject);

    gzip.write(data);
    gzip.end();
  });
}

// Initialize backup bucket on startup
async function initializeBackupBucket(): Promise<void> {
  try {
    const exists = await s3.headBucket({ Bucket: BACKUP_BUCKET }).promise().then(() => true).catch(() => false);
    if (!exists) {
      await s3.createBucket({ Bucket: BACKUP_BUCKET }).promise();
      logger.info('Backup bucket created', { bucket: BACKUP_BUCKET });
    }
  } catch (error) {
    logger.error('Backup bucket initialization failed', error instanceof Error ? error : new Error(String(error)));
  }
}

// Initialize on module load
initializeBackupBucket().catch(err => {
  logger.warn('Backup bucket initialization skipped', err instanceof Error ? err : new Error(String(err)));
});

// Singleton instance
export const automatedBackupService = new AutomatedBackupService();
