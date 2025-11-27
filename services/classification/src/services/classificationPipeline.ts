import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { DocumentStatus, DocumentType, TenantId } from '@ai-accountant/shared-types';
import { recordDocumentStageTransition } from '@ai-accountant/document-ingest-service/services/documentWorkflow';
import { routeToReviewQueue } from './reviewQueueManager';

export interface ClassificationOutcome {
  requiresReview: boolean;
  reviewReason?: string;
  shouldPostToLedger: boolean;
  persistedResultId?: string;
}

export interface ClassificationPersistenceInput {
  tenantId: TenantId;
  documentId: string;
  ingestionLogId?: string | null;
  documentType: DocumentType;
  confidenceScore: number;
  extractedData: Record<string, unknown>;
  fieldConfidences?: Record<string, number>;
  qualityScore?: number | null;
  modelVersion?: string;
}

const logger = createLogger('classification-pipeline');

const CONFIDENCE_THRESHOLD = parseFloat(
  process.env.CLASSIFICATION_CONFIDENCE_THRESHOLD || '0.75'
);
const LEDGER_CONFIDENCE_THRESHOLD = parseFloat(
  process.env.CLASSIFICATION_LEDGER_CONFIDENCE_THRESHOLD || '0.82'
);

/**
 * Persist a classification result into the analytics table and decide routing.
 */
export async function persistClassificationOutcome(
  input: ClassificationPersistenceInput
): Promise<ClassificationOutcome> {
  const requiresReview =
    input.confidenceScore < CONFIDENCE_THRESHOLD ||
    (typeof input.qualityScore === 'number' && input.qualityScore < 70);
  const shouldPostToLedger =
    input.confidenceScore >= LEDGER_CONFIDENCE_THRESHOLD &&
    (input.documentType === DocumentType.INVOICE ||
      input.documentType === DocumentType.RECEIPT);

  const reviewReason = requiresReview
    ? `Confidence ${input.confidenceScore.toFixed(2)} or quality ${
        input.qualityScore ?? 'n/a'
      } below threshold`
    : undefined;

  const resultId = await insertClassificationResult(input, requiresReview, reviewReason);

  if (requiresReview) {
    await routeToReviewQueue(input.tenantId, input.documentId);
    await recordDocumentStageTransition({
      documentId: input.documentId,
      tenantId: input.tenantId,
      toStatus: DocumentStatus.PENDING_REVIEW,
      trigger: 'classification_low_confidence',
      metadata: {
        confidence: input.confidenceScore,
        quality: input.qualityScore,
      },
      errorMessage: reviewReason,
    }).catch((error) =>
      logger.warn('Failed to record review routing transition', error as Error)
    );
  }

  logger.info('Classification outcome persisted', {
    documentId: input.documentId,
    resultId,
    requiresReview,
    shouldPostToLedger,
  });

  return {
    requiresReview,
    reviewReason,
    shouldPostToLedger,
    persistedResultId: resultId,
  };
}

async function insertClassificationResult(
  input: ClassificationPersistenceInput,
  requiresReview: boolean,
  reviewReason?: string
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO classification_results (
       tenant_id,
       document_id,
       ingestion_log_id,
       document_type,
       confidence_score,
       model_version,
       model_type,
       extracted_fields,
       field_confidence_scores,
       vendor_name,
       vendor_confidence,
       total_amount,
       currency,
       quality_score,
       completeness_score,
       requires_review,
       review_reason,
       created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
       $10, $11, $12, $13, $14, $15, $16, $17, NOW()
     ) RETURNING id`,
    [
      input.tenantId,
      input.documentId,
      input.ingestionLogId || null,
      input.documentType,
      input.confidenceScore,
      input.modelVersion || '1.0.0',
      'hybrid',
      JSON.stringify(input.extractedData),
      JSON.stringify(input.fieldConfidences || {}),
      input.extractedData.vendor || null,
      input.fieldConfidences?.vendor || input.confidenceScore,
      input.extractedData.total || null,
      input.extractedData.currency || 'GBP',
      input.qualityScore || null,
      input.extractedData ? calculateCompleteness(input.extractedData) : null,
      requiresReview,
      reviewReason || null,
    ]
  );

  return result.rows[0]?.id as string;
}

function calculateCompleteness(extractedData: Record<string, unknown>): number {
  const importantFields = ['vendor', 'date', 'total', 'currency'];
  const present = importantFields.filter((field) =>
    Boolean(extractedData[field])
  ).length;
  return parseFloat((present / importantFields.length).toFixed(2));
}
