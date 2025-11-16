import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';

const logger = createLogger('backup-catalog');

export type BackupType = 'database' | 'object_storage' | 'full';
export type BackupStatus = 'in_progress' | 'completed' | 'failed';

export interface BackupRecord {
  id: string;
  backupType: BackupType;
  backupName: string;
  storageLocation: string;
  storageSizeBytes: number | null;
  checksum: string | null;
  backupStartedAt: Date;
  backupCompletedAt: Date | null;
  backupStatus: BackupStatus;
  pitrTimestamp: Date | null;
  retentionUntil: Date | null;
  metadata: Record<string, unknown>;
}

/**
 * Backup Catalog Service (Chunk 4)
 * Manages backup metadata and restore operations
 */
export class BackupCatalogService {
  /**
   * Create backup record
   */
  async createBackup(
    backupType: BackupType,
    backupName: string,
    storageLocation: string,
    pitrTimestamp?: Date,
    retentionDays?: number
  ): Promise<string> {
    const backupId = randomUUID();
    const retentionUntil = retentionDays
      ? new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
      : null;

    await db.query(
      `INSERT INTO backup_catalog (
        id, backup_type, backup_name, storage_location, backup_started_at,
        backup_status, pitr_timestamp, retention_until, metadata, created_at
      ) VALUES (
        $1, $2, $3, $4, NOW(), 'in_progress', $5, $6, '{}'::jsonb, NOW()
      )`,
      [backupId, backupType, backupName, storageLocation, pitrTimestamp || null, retentionUntil]
    );

    logger.info('Backup record created', { backupId, backupType, backupName });
    return backupId;
  }

  /**
   * Complete backup
   */
  async completeBackup(
    backupId: string,
    storageSizeBytes: number,
    backupBuffer?: Buffer
  ): Promise<void> {
    const checksum = backupBuffer ? createHash('sha256').update(backupBuffer).digest('hex') : null;

    await db.query(
      `UPDATE backup_catalog
       SET backup_status = 'completed',
           backup_completed_at = NOW(),
           storage_size_bytes = $1,
           checksum = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [storageSizeBytes, checksum, backupId]
    );

    logger.info('Backup completed', { backupId, storageSizeBytes, checksum });
  }

  /**
   * Mark backup as failed
   */
  async failBackup(backupId: string, error: string): Promise<void> {
    await db.query(
      `UPDATE backup_catalog
       SET backup_status = 'failed',
           backup_completed_at = NOW(),
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{error}', to_jsonb($1::text)),
           updated_at = NOW()
       WHERE id = $2`,
      [error, backupId]
    );

    logger.error('Backup failed', { backupId, error });
  }

  /**
   * Get backup by ID
   */
  async getBackup(backupId: string): Promise<BackupRecord | null> {
    const result = await db.query<{
      id: string;
      backup_type: string;
      backup_name: string;
      storage_location: string;
      storage_size_bytes: number | null;
      checksum: string | null;
      backup_started_at: Date;
      backup_completed_at: Date | null;
      backup_status: string;
      pitr_timestamp: Date | null;
      retention_until: Date | null;
      metadata: unknown;
    }>(
      `SELECT * FROM backup_catalog WHERE id = $1`,
      [backupId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      backupType: row.backup_type as BackupType,
      backupName: row.backup_name,
      storageLocation: row.storage_location,
      storageSizeBytes: row.storage_size_bytes,
      checksum: row.checksum,
      backupStartedAt: row.backup_started_at,
      backupCompletedAt: row.backup_completed_at,
      backupStatus: row.backup_status as BackupStatus,
      pitrTimestamp: row.pitr_timestamp,
      retentionUntil: row.retention_until,
      metadata: (row.metadata as Record<string, unknown>) || {},
    };
  }

  /**
   * List backups
   */
  async listBackups(
    backupType?: BackupType,
    limit: number = 50
  ): Promise<BackupRecord[]> {
    let query = `SELECT * FROM backup_catalog WHERE 1=1`;
    const params: unknown[] = [];

    if (backupType) {
      query += ` AND backup_type = $1`;
      params.push(backupType);
    }

    query += ` ORDER BY backup_started_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await db.query<{
      id: string;
      backup_type: string;
      backup_name: string;
      storage_location: string;
      storage_size_bytes: number | null;
      checksum: string | null;
      backup_started_at: Date;
      backup_completed_at: Date | null;
      backup_status: string;
      pitr_timestamp: Date | null;
      retention_until: Date | null;
      metadata: unknown;
    }>(query, params);

    return result.rows.map(row => ({
      id: row.id,
      backupType: row.backup_type as BackupType,
      backupName: row.backup_name,
      storageLocation: row.storage_location,
      storageSizeBytes: row.storage_size_bytes,
      checksum: row.checksum,
      backupStartedAt: row.backup_started_at,
      backupCompletedAt: row.backup_completed_at,
      backupStatus: row.backup_status as BackupStatus,
      pitrTimestamp: row.pitr_timestamp,
      retentionUntil: row.retention_until,
      metadata: (row.metadata as Record<string, unknown>) || {},
    }));
  }

  /**
   * Record restore test
   */
  async recordRestoreTest(
    backupId: string,
    restoreTimeSeconds: number,
    dataIntegrityCheck: boolean,
    testedBy: string,
    notes?: string
  ): Promise<string> {
    const testId = randomUUID();

    await db.query(
      `INSERT INTO backup_restore_tests (
        id, backup_id, test_started_at, test_status, restore_time_seconds,
        data_integrity_check, tested_by, notes, created_at
      ) VALUES (
        $1, $2, NOW(), $3, $4, $5, $6, $7, NOW()
      )`,
      [
        testId,
        backupId,
        dataIntegrityCheck ? 'passed' : 'failed',
        restoreTimeSeconds,
        dataIntegrityCheck,
        testedBy,
        notes || null,
      ]
    );

    // Update test completion
    await db.query(
      `UPDATE backup_restore_tests
       SET test_completed_at = NOW(),
           test_results = $1::jsonb
       WHERE id = $2`,
      [
        JSON.stringify({
          restoreTimeSeconds,
          dataIntegrityCheck,
          rto: restoreTimeSeconds < 3600 ? 'met' : 'exceeded', // 1 hour RTO
        }),
        testId,
      ]
    );

    logger.info('Restore test recorded', { testId, backupId, restoreTimeSeconds, dataIntegrityCheck });
    return testId;
  }

  /**
   * Get latest restore test
   */
  async getLatestRestoreTest(backupId: string): Promise<{
    id: string;
    testStatus: 'running' | 'passed' | 'failed';
    restoreTimeSeconds: number | null;
    dataIntegrityCheck: boolean | null;
    testStartedAt: Date;
    testCompletedAt: Date | null;
  } | null> {
    const result = await db.query<{
      id: string;
      test_status: string;
      restore_time_seconds: number | null;
      data_integrity_check: boolean | null;
      test_started_at: Date;
      test_completed_at: Date | null;
    }>(
      `SELECT * FROM backup_restore_tests
       WHERE backup_id = $1
       ORDER BY test_started_at DESC
       LIMIT 1`,
      [backupId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      testStatus: row.test_status as 'running' | 'passed' | 'failed',
      restoreTimeSeconds: row.restore_time_seconds,
      dataIntegrityCheck: row.data_integrity_check,
      testStartedAt: row.test_started_at,
      testCompletedAt: row.test_completed_at,
    };
  }
}

export const backupCatalogService = new BackupCatalogService();
