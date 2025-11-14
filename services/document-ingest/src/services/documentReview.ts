import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId } from '@ai-accountant/shared-types';

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
  extractedData: Record<string, unknown>
): Promise<void> {
  await db.query(
    `UPDATE documents
     SET extracted_data = $1::jsonb,
         updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [JSON.stringify(extractedData), documentId, tenantId]
  );

  logger.info('Extracted data updated', { documentId, tenantId });
}

export async function approveDocument(
  documentId: DocumentId,
  tenantId: TenantId
): Promise<void> {
  await db.query(
    `UPDATE documents
     SET status = 'classified',
         updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [documentId, tenantId]
  );

  logger.info('Document approved', { documentId, tenantId });
}

export async function rejectDocument(
  documentId: DocumentId,
  tenantId: TenantId,
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

  logger.info('Document rejected', { documentId, tenantId, reason });
}
