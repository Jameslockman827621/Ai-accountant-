import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId } from '@ai-accountant/shared-types';
import crypto from 'crypto';

const logger = createLogger('document-ingest-service');

export interface DocumentVersion {
  version: number;
  documentId: DocumentId;
  changes: Record<string, { old: unknown; new: unknown }>;
  changedBy: string;
  changedAt: Date;
  hash: string; // Immutable hash
}

/**
 * Create new document version
 */
export async function createDocumentVersion(
  tenantId: TenantId,
  documentId: DocumentId,
  changes: Record<string, { old: unknown; new: unknown }>,
  changedBy: string
): Promise<number> {
  // Get current version
  const currentVersion = await db.query<{ max_version: number | null }>(
    `SELECT MAX(version) as max_version
     FROM document_versions
     WHERE tenant_id = $1 AND document_id = $2`,
    [tenantId, documentId]
  );

  const newVersion = (currentVersion.rows[0]?.max_version || 0) + 1;
  const timestamp = new Date();

  // Create hash
  const hashInput = JSON.stringify({
    documentId,
    version: newVersion,
    changes,
    changedBy,
    timestamp: timestamp.toISOString(),
  });
  const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

  await db.query(
    `INSERT INTO document_versions (
      id, tenant_id, document_id, version, changes, changed_by, changed_at, hash, created_at
    ) VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, $6, $7, NOW())`,
    [tenantId, documentId, newVersion, JSON.stringify(changes), changedBy, timestamp, hash]
  );

  logger.info('Document version created', { documentId, version: newVersion, tenantId });
  return newVersion;
}

/**
 * Get document version history
 */
export async function getDocumentVersions(
  tenantId: TenantId,
  documentId: DocumentId
): Promise<DocumentVersion[]> {
  const result = await db.query<{
    version: number;
    document_id: string;
    changes: unknown;
    changed_by: string;
    changed_at: Date;
    hash: string;
  }>(
    `SELECT version, document_id, changes, changed_by, changed_at, hash
     FROM document_versions
     WHERE tenant_id = $1 AND document_id = $2
     ORDER BY version DESC`,
    [tenantId, documentId]
  );

  return result.rows.map(row => ({
    version: row.version,
    documentId: row.document_id,
    changes: row.changes as Record<string, { old: unknown; new: unknown }>,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
    hash: row.hash,
  }));
}

/**
 * Restore document to specific version
 */
export async function restoreDocumentVersion(
  tenantId: TenantId,
  documentId: DocumentId,
  version: number,
  restoredBy: string
): Promise<void> {
  const versionData = await db.query<{
    changes: unknown;
  }>(
    `SELECT changes FROM document_versions
     WHERE tenant_id = $1 AND document_id = $2 AND version = $3`,
    [tenantId, documentId, version]
  );

  if (versionData.rows.length === 0) {
    throw new Error('Version not found');
  }

  const changes = versionData.rows[0].changes as Record<string, { old: unknown; new: unknown }>;

  // Apply changes in reverse
  const reverseChanges: Record<string, { old: unknown; new: unknown }> = {};
  Object.entries(changes).forEach(([key, change]) => {
    reverseChanges[key] = { old: change.new, new: change.old };
  });

  // Update document
  await db.query(
    `UPDATE documents
     SET extracted_data = COALESCE(extracted_data, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [JSON.stringify(reverseChanges), documentId, tenantId]
  );

  // Create new version for restoration
  await createDocumentVersion(tenantId, documentId, reverseChanges, restoredBy);

  logger.info('Document version restored', { documentId, version, tenantId });
}
