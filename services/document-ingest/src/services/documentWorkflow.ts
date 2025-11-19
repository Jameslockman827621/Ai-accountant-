import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { DocumentStatus, TenantId } from '@ai-accountant/shared-types';

export type DocumentProcessingStage =
  | 'document'
  | 'ocr'
  | 'classification'
  | 'ledger_posting'
  | 'completed'
  | 'error';

const logger = createLogger('document-workflow-service');

const STATUS_STAGE_MAP: Record<DocumentStatus, DocumentProcessingStage> = {
  [DocumentStatus.UPLOADED]: 'document',
  [DocumentStatus.PROCESSING]: 'ocr',
  [DocumentStatus.EXTRACTED]: 'classification',
  [DocumentStatus.CLASSIFIED]: 'ledger_posting',
  [DocumentStatus.POSTED]: 'completed',
  [DocumentStatus.ERROR]: 'error',
};

export function getStageForStatus(status: DocumentStatus | null | undefined): DocumentProcessingStage {
  if (!status) {
    return 'document';
  }
  return STATUS_STAGE_MAP[status] ?? 'document';
}

export interface StageTransitionOptions {
  documentId: string;
  tenantId: TenantId;
  toStatus: DocumentStatus;
  trigger: string;
  metadata?: Record<string, unknown>;
  updateDocumentStatus?: boolean;
  errorMessage?: string | null;
}

export interface DocumentStageHistoryRow {
  id: string;
  fromStatus: DocumentStatus | null;
  toStatus: DocumentStatus;
  fromStage: DocumentProcessingStage | null;
  toStage: DocumentProcessingStage;
  trigger: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export async function recordDocumentStageTransition(options: StageTransitionOptions): Promise<void> {
  const {
    documentId,
    tenantId,
    toStatus,
    trigger,
    metadata,
    updateDocumentStatus = true,
    errorMessage = null,
  } = options;

  const toStage = getStageForStatus(toStatus);

  try {
    await db.transaction(async (client) => {
      const docResult = await client.query<{
        status: DocumentStatus | null;
      }>(
        `SELECT status
         FROM documents
         WHERE id = $1 AND tenant_id = $2
         FOR UPDATE`,
        [documentId, tenantId]
      );

      if (docResult.rows.length === 0) {
        throw new Error('Document not found for stage transition');
      }

      const previousStatus = docResult.rows[0].status;
      const fromStage = previousStatus ? getStageForStatus(previousStatus) : null;

      if (updateDocumentStatus) {
        await client.query(
          `UPDATE documents
             SET status = $1,
                 processing_stage = $2,
                 error_message = $3,
                 updated_at = NOW()
           WHERE id = $4 AND tenant_id = $5`,
          [toStatus, toStage, errorMessage, documentId, tenantId]
        );
      } else {
        await client.query(
          `UPDATE documents
             SET processing_stage = $1,
                 error_message = COALESCE($2, error_message),
                 updated_at = NOW()
           WHERE id = $3 AND tenant_id = $4`,
          [toStage, errorMessage, documentId, tenantId]
        );
      }

      await client.query(
        `INSERT INTO document_stage_history (
            document_id,
            tenant_id,
            from_status,
            to_status,
            from_stage,
            to_stage,
            trigger,
            metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          documentId,
          tenantId,
          previousStatus,
          toStatus,
          fromStage,
          toStage,
          trigger,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );
    });
  } catch (error) {
    logger.error(
      'Failed to record document stage transition',
      error instanceof Error ? error : new Error(String(error)),
      { documentId, tenantId, toStatus, trigger }
    );
    throw error;
  }
}

export async function getDocumentStageHistory(
  documentId: string,
  tenantId: TenantId
): Promise<DocumentStageHistoryRow[]> {
  const result = await db.query<{
    id: string;
    from_status: DocumentStatus | null;
    to_status: DocumentStatus;
    from_stage: DocumentProcessingStage | null;
    to_stage: DocumentProcessingStage;
    trigger: string;
    metadata: Record<string, unknown> | null;
    created_at: Date;
  }>(
    `SELECT id, from_status, to_status, from_stage, to_stage, trigger, metadata, created_at
     FROM document_stage_history
     WHERE document_id = $1 AND tenant_id = $2
     ORDER BY created_at ASC`,
    [documentId, tenantId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    fromStage: row.from_stage,
    toStage: row.to_stage,
    trigger: row.trigger,
    metadata: row.metadata,
    createdAt: row.created_at,
  }));
}
