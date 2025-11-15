import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('document-ingest-service');

export interface DocumentReviewItem {
  documentId: DocumentId;
  fileName: string;
  documentType: string | null;
  confidenceScore: number | null;
  extractedData: Record<string, unknown> | null;
  requiresReview: boolean;
  reason?: string;
}

export interface DocumentAuditEntry {
  id: string;
  action: string;
  message: string;
  changes?: Record<string, unknown> | null;
  userId: UserId | null;
  userName: string | null;
  userEmail: string | null;
  createdAt: string;
}

async function logDocumentAudit(
  tenantId: TenantId,
  userId: UserId,
  documentId: DocumentId,
  action: string,
  changes?: Record<string, unknown>
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO audit_logs (tenant_id, user_id, action, resource_type, resource_id, changes, created_at)
       VALUES ($1, $2, $3, 'document', $4, $5::jsonb, NOW())`,
      [tenantId, userId, action, documentId, JSON.stringify(changes || {})]
    );
  } catch (error) {
    logger.warn('Failed to log document audit entry', error instanceof Error ? error : new Error(String(error)));
  }
}

export async function getReviewQueue(
  tenantId: TenantId,
  limit: number = 50
): Promise<DocumentReviewItem[]> {
  // Get documents with low confidence or missing critical fields
  const result = await db.query<{
    id: string;
    file_name: string;
    document_type: string | null;
    confidence_score: number | null;
    extracted_data: unknown;
  }>(
    `SELECT id, file_name, document_type, confidence_score, extracted_data
     FROM documents
     WHERE tenant_id = $1
       AND status IN ('extracted', 'classified')
       AND (
         confidence_score IS NULL OR confidence_score < 0.85
         OR extracted_data->>'total' IS NULL
         OR extracted_data->>'date' IS NULL
       )
     ORDER BY 
       CASE WHEN confidence_score IS NULL THEN 0 ELSE confidence_score END ASC,
       created_at ASC
     LIMIT $2`,
    [tenantId, limit]
  );

  return result.rows.map(row => {
    const extractedData = row.extracted_data as Record<string, unknown> | null;
    const confidence = row.confidence_score || 0;
    
    let requiresReview = false;
    let reason: string | undefined;

    if (confidence < 0.70) {
      requiresReview = true;
      reason = 'Confidence score below critical threshold (<70%)';
    } else if (confidence < 0.85) {
      requiresReview = true;
      reason = 'Confidence score below recommended threshold (<85%)';
    }

    if (extractedData) {
      if (!extractedData.total) {
        requiresReview = true;
        reason = reason ? `${reason}; Missing total amount` : 'Missing total amount';
      }
      if (!extractedData.date) {
        requiresReview = true;
        reason = reason ? `${reason}; Missing date` : 'Missing date';
      }
    }

    return {
      documentId: row.id,
      fileName: row.file_name,
      documentType: row.document_type,
      confidenceScore: confidence,
      extractedData,
      requiresReview,
      reason,
    };
  });
}

export async function updateExtractedData(
  documentId: DocumentId,
  tenantId: TenantId,
  userId: UserId,
  extractedData: Record<string, unknown>
): Promise<void> {
  const previous = await db.query<{ extracted_data: unknown }>(
    'SELECT extracted_data FROM documents WHERE id = $1 AND tenant_id = $2',
    [documentId, tenantId]
  );

  await db.query(
    `UPDATE documents
     SET extracted_data = $1::jsonb,
         updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [JSON.stringify(extractedData), documentId, tenantId]
  );

  await logDocumentAudit(tenantId, userId, documentId, 'document_update', {
    before: previous.rows[0]?.extracted_data ?? null,
    after: extractedData,
  });

  logger.info('Extracted data updated', { documentId, tenantId });
}

export async function approveDocument(
  documentId: DocumentId,
  tenantId: TenantId,
  userId: UserId
): Promise<void> {
  await db.query(
    `UPDATE documents
     SET status = 'classified',
         updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [documentId, tenantId]
  );

  await logDocumentAudit(tenantId, userId, documentId, 'document_approved', {
    status: 'classified',
  });

  logger.info('Document approved', { documentId, tenantId });
}

export async function rejectDocument(
  documentId: DocumentId,
  tenantId: TenantId,
  userId: UserId,
  reason: string
): Promise<void> {
  await db.query(
    `UPDATE documents
     SET status = 'error',
         error_message = $1,
         updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
      [reason, documentId, tenantId]
  );

  await logDocumentAudit(tenantId, userId, documentId, 'document_rejected', {
    status: 'error',
    reason,
  });

  logger.info('Document rejected', { documentId, tenantId, reason });
}

export async function getDocumentAuditLog(
  documentId: DocumentId,
  tenantId: TenantId,
  limit: number = 25
): Promise<DocumentAuditEntry[]> {
  const result = await db.query<{
    id: string;
    action: string;
    changes: unknown;
    created_at: Date;
    user_id: string | null;
    user_name: string | null;
    user_email: string | null;
  }>(
    `SELECT a.id,
            a.action,
            a.changes,
            a.created_at,
            a.user_id,
            u.name as user_name,
            u.email as user_email
     FROM audit_logs a
     LEFT JOIN users u ON a.user_id = u.id
     WHERE a.tenant_id = $1
       AND a.resource_type = 'document'
       AND a.resource_id = $2
     ORDER BY a.created_at DESC
     LIMIT $3`,
    [tenantId, documentId, limit]
  );

  return result.rows.map(row => ({
    id: row.id,
    action: row.action,
    message: buildAuditMessage(row.action),
    changes: (row.changes as Record<string, unknown> | null) || null,
    userId: (row.user_id as UserId | null) ?? null,
    userName: row.user_name,
    userEmail: row.user_email,
    createdAt: row.created_at.toISOString(),
  }));
}

function buildAuditMessage(action: string): string {
  switch (action) {
    case 'document_update':
      return 'Document data updated';
    case 'document_approved':
      return 'Document approved for posting';
    case 'document_rejected':
      return 'Document rejected';
    default:
      return action.replace(/_/g, ' ');
  }
}
