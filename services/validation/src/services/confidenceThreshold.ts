import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId } from '@ai-accountant/shared-types';

const logger = createLogger('validation-service');

export interface ConfidenceCheck {
  documentId: DocumentId;
  confidenceScore: number;
  requiresReview: boolean;
  reason?: string;
}

export const MIN_CONFIDENCE_THRESHOLD = 0.85;
export const CRITICAL_CONFIDENCE_THRESHOLD = 0.7;

export async function checkConfidenceThresholds(tenantId: TenantId): Promise<ConfidenceCheck[]> {
  logger.info('Checking confidence thresholds', { tenantId });

  const documents = await db.query<{
    id: string;
    confidence_score: number | null;
    document_type: string | null;
    extracted_data: unknown;
  }>(
    `SELECT id, confidence_score, document_type, extracted_data
     FROM documents
     WHERE tenant_id = $1
       AND status IN ('extracted', 'classified')
       AND confidence_score IS NOT NULL`,
    [tenantId]
  );

  const checks: ConfidenceCheck[] = [];

  for (const doc of documents.rows) {
    const confidence = doc.confidence_score || 0;
    let requiresReview = false;
    let reason: string | undefined;

    if (confidence < CRITICAL_CONFIDENCE_THRESHOLD) {
      requiresReview = true;
      reason = 'Confidence score below critical threshold (<70%)';
    } else if (confidence < MIN_CONFIDENCE_THRESHOLD) {
      requiresReview = true;
      reason = 'Confidence score below recommended threshold (<85%)';
    }

    // Additional checks based on document type
    if (doc.document_type === 'invoice' || doc.document_type === 'receipt') {
      const extractedData = (doc.extracted_data as Record<string, unknown> | null) ?? null;

      // Check if critical fields are missing
      if (extractedData) {
        const missingFields: string[] = [];
        const totalValue = extractedData['total'];
        const dateValue = extractedData['date'];
        const invoiceNumberValue = extractedData['invoiceNumber'];

        if (!isPresent(totalValue)) missingFields.push('total');
        if (!isPresent(dateValue)) missingFields.push('date');
        if (doc.document_type === 'invoice' && !isPresent(invoiceNumberValue)) {
          missingFields.push('invoiceNumber');
        }

        if (missingFields.length > 0) {
          requiresReview = true;
          reason = `Missing critical fields: ${missingFields.join(', ')}`;
        }

        // Check for unusual values
        if (isPresent(totalValue)) {
          const total =
            typeof totalValue === 'number' ? totalValue : parseFloat(String(totalValue ?? '0'));

          if (total <= 0) {
            requiresReview = true;
            reason = 'Total amount is zero or negative';
          } else if (total > 1000000) {
            requiresReview = true;
            reason = 'Total amount is unusually large (>£1,000,000)';
          }
        }
      }
    }

    const check: ConfidenceCheck = {
      documentId: doc.id,
      confidenceScore: confidence,
      requiresReview,
    };
    if (reason) {
      check.reason = reason;
    }
    checks.push(check);
  }

  return checks;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  return true;
}

export async function enforceConfidenceThreshold(
  documentId: DocumentId,
  tenantId: TenantId
): Promise<boolean> {
  const result = await db.query<{
    confidence_score: number | null;
    status: string;
  }>('SELECT confidence_score, status FROM documents WHERE id = $1 AND tenant_id = $2', [
    documentId,
    tenantId,
  ]);

  if (result.rows.length === 0) {
    return false;
  }

  const doc = result.rows[0];
  if (!doc) {
    return false;
  }
  const confidence = doc.confidence_score || 0;

  // If confidence is below threshold, mark for review
  if (confidence < MIN_CONFIDENCE_THRESHOLD && doc.status !== 'error') {
    await db.query(
      `UPDATE documents
       SET status = 'classified',
           updated_at = NOW()
       WHERE id = $1`,
      [documentId]
    );

    // Create review task
    await db.query(
      `INSERT INTO review_tasks (id, tenant_id, type, entity_id, status, priority, comments, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'document', $2, 'pending', 'high', '[]'::jsonb, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [tenantId, documentId]
    );

    logger.info('Document marked for review due to low confidence', {
      documentId,
      confidence,
    });

    return true;
  }

  return false;
}
