import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import AWS from 'aws-sdk';

const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
});

const BUCKET_NAME = process.env.S3_BUCKET || 'ai-accountant-documents';

async function uploadFile(key: string, buffer: Buffer, contentType: string): Promise<void> {
  await s3.putObject({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }).promise();
}

async function getFile(key: string): Promise<Buffer> {
  const result = await s3.getObject({
    Bucket: BUCKET_NAME,
    Key: key,
  }).promise();
  return Buffer.from(result.Body as string);
}

const logger = createLogger('backup-service');

export interface BackupRecord {
  id: string;
  tenantId: TenantId;
  backupType: 'automated' | 'manual' | 'export';
  storageLocation: string;
  fileSize: number | null;
  status: 'in_progress' | 'completed' | 'failed';
  errorMessage: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export async function createBackup(
  tenantId: TenantId,
  backupType: BackupRecord['backupType'] = 'manual'
): Promise<string> {
  const backupId = crypto.randomUUID();
  const storageKey = `backups/${tenantId}/${backupId}.json`;

  // Create backup record
  await db.query(
    `INSERT INTO backup_records (
      id, tenant_id, backup_type, storage_location, status, created_at
    ) VALUES ($1, $2, $3, $4, 'in_progress', NOW())`,
    [backupId, tenantId, backupType, storageKey]
  );

  try {
    // Export all tenant data
    const exportData = await exportTenantData(tenantId);

    // Store backup
    const backupJson = JSON.stringify(exportData, null, 2);
    await uploadFile(storageKey, Buffer.from(backupJson, 'utf-8'), 'application/json');

    // Update backup record
    await db.query(
      `UPDATE backup_records
       SET status = 'completed',
           file_size = $1,
           completed_at = NOW()
       WHERE id = $2`,
      [backupJson.length, backupId]
    );

    logger.info('Backup created', { backupId, tenantId, backupType });
    return backupId;
  } catch (error) {
    // Update backup record with error
    await db.query(
      `UPDATE backup_records
       SET status = 'failed',
           error_message = $1,
           completed_at = NOW()
       WHERE id = $2`,
      [error instanceof Error ? error.message : 'Backup failed', backupId]
    );

    logger.error('Backup failed', { backupId, tenantId, error });
    throw error;
  }
}

export async function exportTenantData(tenantId: TenantId): Promise<Record<string, unknown>> {
  // Export all tenant data
  const [tenant, users, documents, ledgerEntries, filings, bankTransactions, subscriptions] = await Promise.all([
    db.query('SELECT * FROM tenants WHERE id = $1', [tenantId]),
    db.query('SELECT id, tenant_id, email, name, role, is_active, created_at, updated_at FROM users WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT * FROM documents WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT * FROM ledger_entries WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT * FROM filings WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT * FROM bank_transactions WHERE tenant_id = $1', [tenantId]),
    db.query('SELECT * FROM subscriptions WHERE tenant_id = $1', [tenantId]),
  ]);

  return {
    tenant: tenant.rows[0],
    users: users.rows,
    documents: documents.rows,
    ledgerEntries: ledgerEntries.rows,
    filings: filings.rows,
    bankTransactions: bankTransactions.rows,
    subscriptions: subscriptions.rows,
    exportedAt: new Date().toISOString(),
  };
}

export async function getBackup(backupId: string, tenantId: TenantId): Promise<BackupRecord | null> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    backup_type: string;
    storage_location: string;
    file_size: number | null;
    status: string;
    error_message: string | null;
    created_at: Date;
    completed_at: Date | null;
  }>(
    'SELECT * FROM backup_records WHERE id = $1 AND tenant_id = $2',
    [backupId, tenantId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: row.tenant_id,
    backupType: row.backup_type as BackupRecord['backupType'],
    storageLocation: row.storage_location,
    fileSize: row.file_size,
    status: row.status as BackupRecord['status'],
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export async function getBackups(tenantId: TenantId): Promise<BackupRecord[]> {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    backup_type: string;
    storage_location: string;
    file_size: number | null;
    status: string;
    error_message: string | null;
    created_at: Date;
    completed_at: Date | null;
  }>(
    'SELECT * FROM backup_records WHERE tenant_id = $1 ORDER BY created_at DESC',
    [tenantId]
  );

  return result.rows.map(row => ({
    id: row.id,
    tenantId: row.tenant_id,
    backupType: row.backup_type as BackupRecord['backupType'],
    storageLocation: row.storage_location,
    fileSize: row.file_size,
    status: row.status as BackupRecord['status'],
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

export async function downloadBackup(backupId: string, tenantId: TenantId): Promise<Buffer> {
  const backup = await getBackup(backupId, tenantId);

  if (!backup) {
    throw new Error('Backup not found');
  }

  if (backup.status !== 'completed') {
    throw new Error('Backup is not completed');
  }

  const fileBuffer = await getFile(backup.storageLocation);
  return fileBuffer;
}
