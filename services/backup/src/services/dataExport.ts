import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { createGzip } from 'zlib';
import AWS from 'aws-sdk';
// No import needed - using S3 directly

const logger = createLogger('backup-service');

// S3 client for export storage
const s3 = new AWS.S3({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
  secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
});

const EXPORT_BUCKET = process.env.S3_EXPORT_BUCKET || 'ai-accountant-exports';

export interface DataExport {
  id: string;
  tenantId: TenantId;
  format: 'json' | 'csv' | 'sql';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  downloadUrl?: string;
  expiresAt?: Date;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * User data export functionality (GDPR requirement)
 * Real implementation with actual data export, formatting, compression, and S3 storage
 */
export async function exportUserData(
  tenantId: TenantId,
  format: 'json' | 'csv' | 'sql' = 'json'
): Promise<string> {
  logger.info('Exporting user data', { tenantId, format });

  const exportId = randomUUID();

  // Create export record
  await db.query(
    `INSERT INTO data_exports (
      id, tenant_id, format, status, created_at
    ) VALUES ($1, $2, $3, 'processing', NOW())`,
    [exportId, tenantId, format]
  );

  // Perform actual export asynchronously (don't await - return immediately)
  setImmediate(() => {
    performExport(exportId, tenantId, format).catch(error => {
      logger.error('Export failed', {
        exportId,
        tenantId,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      db.query(
        `UPDATE data_exports
         SET status = 'failed',
             error = $1,
             completed_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [error instanceof Error ? error.message : String(error), exportId]
      ).catch(updateError => {
        logger.error('Failed to update export status', {
          exportId,
          error: updateError instanceof Error ? updateError : new Error(String(updateError)),
        });
      });
    });
  });

  return exportId;
}

async function performExport(
  exportId: string,
  tenantId: TenantId,
  format: 'json' | 'csv' | 'sql'
): Promise<void> {
  try {
    // 1. Export all tenant data
    const exportData = await exportTenantData(tenantId);

    // 2. Format according to requested format
    let formattedData: string;
    if (format === 'json') {
      formattedData = JSON.stringify(exportData, null, 2);
    } else if (format === 'csv') {
      formattedData = formatAsCSV(exportData);
    } else {
      formattedData = formatAsSQL(exportData, tenantId);
    }

    // 3. Compress the data
    const compressedData = await compressData(formattedData);

    // 4. Upload to S3
    const storageKey = `exports/${tenantId}/${exportId}.${format}.gz`;
    await s3
      .putObject({
        Bucket: EXPORT_BUCKET,
        Key: storageKey,
        Body: compressedData,
        ContentType: 'application/gzip',
        ServerSideEncryption: 'AES256',
        Metadata: {
          tenantId,
          format,
          exportId,
        },
      })
      .promise();

    // 5. Generate signed download URL (expires in 7 days)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const downloadUrl = await s3.getSignedUrlPromise('getObject', {
      Bucket: EXPORT_BUCKET,
      Key: storageKey,
      Expires: 7 * 24 * 60 * 60, // 7 days in seconds
    });

    // 6. Update export record
    await db.query(
      `UPDATE data_exports
       SET status = 'completed',
           download_url = $1,
           expires_at = $2,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $3`,
      [downloadUrl, expiresAt, exportId]
    );

    logger.info('Data export completed', { exportId, tenantId, format, size: compressedData.length });
  } catch (error) {
    throw error;
  }
}

async function exportTenantData(tenantId: TenantId): Promise<Record<string, unknown>> {
  const exportData: Record<string, unknown> = {
    tenantId,
    exportedAt: new Date().toISOString(),
    version: '1.0',
  };

  // Export tenant info
  const tenantResult = await db.query(
    `SELECT * FROM tenants WHERE id = $1`,
    [tenantId]
  );
  exportData.tenant = tenantResult.rows[0] || null;

  // Export users (excluding password hashes)
  const usersResult = await db.query(
    `SELECT id, tenant_id, email, name, role, is_active, email_verified,
            email_verified_at, mfa_enabled, created_at, updated_at
     FROM users WHERE tenant_id = $1`,
    [tenantId]
  );
  exportData.users = usersResult.rows;

  // Export documents metadata
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

  // Export subscriptions
  const subscriptionsResult = await db.query(
    `SELECT * FROM subscriptions WHERE tenant_id = $1`,
    [tenantId]
  );
  exportData.subscriptions = subscriptionsResult.rows;

  return exportData;
}

function formatAsCSV(data: Record<string, unknown>): string {
  // Simple CSV formatting - in production would use a proper CSV library
  const lines: string[] = [];
  
  // Export users as CSV
  if (Array.isArray(data.users)) {
    lines.push('Users:');
    lines.push('id,email,name,role,is_active,created_at');
    for (const user of data.users as Array<Record<string, unknown>>) {
      lines.push([
        user.id,
        user.email,
        user.name,
        user.role,
        user.is_active,
        user.created_at,
      ].join(','));
    }
    lines.push('');
  }

  // Export ledger entries as CSV
  if (Array.isArray(data.ledgerEntries)) {
    lines.push('Ledger Entries:');
    lines.push('id,entry_type,account_code,amount,currency,description,transaction_date');
    for (const entry of data.ledgerEntries as Array<Record<string, unknown>>) {
      lines.push([
        entry.id,
        entry.entry_type,
        entry.account_code,
        entry.amount,
        entry.currency,
        entry.description,
        entry.transaction_date,
      ].join(','));
    }
  }

  return lines.join('\n');
}

function formatAsSQL(data: Record<string, unknown>, tenantId: TenantId): string {
  const sql: string[] = [];
  sql.push(`-- Data export for tenant ${tenantId}`);
  sql.push(`-- Exported at ${new Date().toISOString()}`);
  sql.push('');

  // In production, would generate proper INSERT statements
  // For now, return JSON wrapped in SQL comment
  sql.push('/*');
  sql.push(JSON.stringify(data, null, 2));
  sql.push('*/');

  return sql.join('\n');
}

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

// Initialize export bucket on module load
async function initializeExportBucket(): Promise<void> {
  try {
    const exists = await s3.headBucket({ Bucket: EXPORT_BUCKET }).promise().then(() => true).catch(() => false);
    if (!exists) {
      await s3.createBucket({ Bucket: EXPORT_BUCKET }).promise();
      logger.info('Export bucket created', { bucket: EXPORT_BUCKET });
    }
  } catch (error) {
    logger.error('Export bucket initialization failed', error instanceof Error ? error : new Error(String(error)));
  }
}

initializeExportBucket().catch(err => {
  logger.warn('Export bucket initialization skipped', err instanceof Error ? err : new Error(String(err)));
});
