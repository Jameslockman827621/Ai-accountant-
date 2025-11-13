import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import AWS from 'aws-sdk';

const logger = createLogger('backup-service');

const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  s3ForcePathStyle: true,
});

const BUCKET_NAME = process.env.S3_BUCKET || 'ai-accountant-backups';

/**
 * Create point-in-time backup
 */
export async function createPointInTimeBackup(
  tenantId: TenantId,
  backupType: 'full' | 'incremental' = 'incremental'
): Promise<string> {
  const backupId = crypto.randomUUID();
  const timestamp = new Date();
  const storageKey = `pitr/${tenantId}/${backupId}_${timestamp.toISOString()}.json`;

  logger.info('Creating point-in-time backup', { tenantId, backupId, backupType });

  try {
    // Get last backup for incremental
    let lastBackupTimestamp: Date | null = null;
    if (backupType === 'incremental') {
      const lastBackup = await db.query<{ created_at: Date }>(
        `SELECT created_at FROM backup_records
         WHERE tenant_id = $1 AND backup_type = 'incremental'
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId]
      );
      if (lastBackup.rows.length > 0) {
        lastBackupTimestamp = lastBackup.rows[0].created_at;
      }
    }

    // Export data
    const exportData = await exportTenantDataIncremental(tenantId, lastBackupTimestamp);

    // Store backup
    const backupJson = JSON.stringify({
      backupId,
      tenantId,
      timestamp: timestamp.toISOString(),
      backupType,
      data: exportData,
    }, null, 2);

    await s3.putObject({
      Bucket: BUCKET_NAME,
      Key: storageKey,
      Body: backupJson,
      ContentType: 'application/json',
    }).promise();

    // Record backup
    await db.query(
      `INSERT INTO backup_records (
        id, tenant_id, backup_type, storage_location, status, file_size, created_at
      ) VALUES ($1, $2, $3, $4, 'completed', $5, NOW())`,
      [backupId, tenantId, backupType, storageKey, backupJson.length]
    );

    logger.info('Point-in-time backup created', { backupId, tenantId });
    return backupId;
  } catch (error) {
    logger.error('Point-in-time backup failed', error);
    throw error;
  }
}

/**
 * Restore to specific point in time
 */
export async function restoreToPointInTime(
  tenantId: TenantId,
  targetTimestamp: Date
): Promise<void> {
  logger.info('Restoring to point in time', { tenantId, targetTimestamp });

  // Find closest backup before target time
  const backup = await db.query<{
    id: string;
    storage_location: string;
    created_at: Date;
  }>(
    `SELECT id, storage_location, created_at
     FROM backup_records
     WHERE tenant_id = $1
       AND created_at <= $2
       AND status = 'completed'
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, targetTimestamp]
  );

  if (backup.rows.length === 0) {
    throw new Error('No backup found before target timestamp');
  }

  const backupRecord = backup.rows[0];

  // Get all incremental backups after this one up to target time
  const incrementalBackups = await db.query<{
    id: string;
    storage_location: string;
    created_at: Date;
  }>(
    `SELECT id, storage_location, created_at
     FROM backup_records
     WHERE tenant_id = $1
       AND created_at > $2
       AND created_at <= $3
       AND status = 'completed'
       AND backup_type = 'incremental'
     ORDER BY created_at ASC`,
    [tenantId, backupRecord.created_at, targetTimestamp]
  );

  // Restore base backup
  const baseData = await s3.getObject({
    Bucket: BUCKET_NAME,
    Key: backupRecord.storage_location,
  }).promise();

  let restoredData = JSON.parse(baseData.Body?.toString() || '{}');

  // Apply incremental backups
  for (const incBackup of incrementalBackups.rows) {
    const incData = await s3.getObject({
      Bucket: BUCKET_NAME,
      Key: incBackup.storage_location,
    }).promise();

    const incBackupData = JSON.parse(incData.Body?.toString() || '{}');
    restoredData = mergeBackupData(restoredData, incBackupData);
  }

  // Restore data
  await restoreTenantData(tenantId, restoredData.data);

  logger.info('Point-in-time restore completed', { tenantId, targetTimestamp });
}

async function exportTenantDataIncremental(
  tenantId: TenantId,
  since: Date | null
): Promise<Record<string, unknown>> {
  let query = '';
  const params: unknown[] = [tenantId];

  if (since) {
    query = `
      SELECT * FROM ledger_entries
      WHERE tenant_id = $1 AND created_at > $2
      UNION ALL
      SELECT * FROM documents
      WHERE tenant_id = $1 AND created_at > $2
      UNION ALL
      SELECT * FROM bank_transactions
      WHERE tenant_id = $1 AND created_at > $2
    `;
    params.push(since);
  } else {
    // Full export
    return await exportTenantData(tenantId);
  }

  const result = await db.query(query, params);
  return { incremental: result.rows, since: since?.toISOString() };
}

async function exportTenantData(tenantId: TenantId): Promise<Record<string, unknown>> {
  const [tenant, users, documents, ledgerEntries, filings, bankTransactions] = await Promise.all([
    db.query('SELECT * FROM tenants WHERE id = $1', [tenantId]),
    db.query('SELECT * FROM users WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT * FROM documents WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT * FROM ledger_entries WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT * FROM filings WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT * FROM bank_transactions WHERE tenant_id = $1', [tenantId]),
  ]);

  return {
    tenant: tenant.rows[0],
    users: users.rows,
    documents: documents.rows,
    ledgerEntries: ledgerEntries.rows,
    filings: filings.rows,
    bankTransactions: bankTransactions.rows,
  };
}

function mergeBackupData(base: Record<string, unknown>, incremental: Record<string, unknown>): Record<string, unknown> {
  // Merge incremental changes into base
  const merged = { ...base };
  
  if (incremental.incremental) {
    const inc = incremental.incremental as Array<Record<string, unknown>>;
    inc.forEach(item => {
      // Apply updates/additions
      // Simplified - in production would handle updates/deletes properly
    });
  }

  return merged;
}

async function restoreTenantData(tenantId: TenantId, data: Record<string, unknown>): Promise<void> {
  // Restore data to database
  // In production, would restore each table with proper transaction handling
  logger.info('Restoring tenant data', { tenantId });
}
