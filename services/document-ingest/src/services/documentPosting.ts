import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId } from '@ai-accountant/shared-types';
import { postDocumentToLedger } from '@ai-accountant/ledger-service/services/posting';
import { applyTaxRules } from '@ai-accountant/rules-engine-service/services/taxRules';

const logger = createLogger('document-ingest-service');

/**
 * Automatically post a classified document to the ledger
 */
export async function autoPostDocument(
  tenantId: TenantId,
  documentId: DocumentId
): Promise<void> {
  logger.info('Auto-posting document to ledger', { tenantId, documentId });

  // Get document
  const docResult = await db.query<{
    extracted_data: unknown;
    document_type: string | null;
    confidence_score: number | null;
    status: string;
  }>(
    'SELECT extracted_data, document_type, confidence_score, status FROM documents WHERE id = $1 AND tenant_id = $2',
    [documentId, tenantId]
  );

  if (docResult.rows.length === 0) {
    throw new Error('Document not found');
  }

  const doc = docResult.rows[0];

  // Only post if classified and confidence is acceptable
  if (doc.status !== 'classified') {
    throw new Error('Document must be classified before posting');
  }

  if ((doc.confidence_score || 0) < 0.70) {
    throw new Error('Document confidence too low for automatic posting');
  }

  const extractedData = doc.extracted_data as Record<string, unknown> | null;

  if (!extractedData || !extractedData.total) {
    throw new Error('Document missing required extracted data');
  }

  // Apply tax rules if needed
  if (extractedData.total && !extractedData.tax) {
    try {
      const taxResult = await applyTaxRules('GB', {
        amount: typeof extractedData.total === 'number' ? extractedData.total : parseFloat(String(extractedData.total || '0')),
        category: extractedData.category as string,
        description: extractedData.description as string,
        vendor: extractedData.vendor as string,
      });

      extractedData.tax = taxResult.taxAmount;
      extractedData.taxRate = taxResult.taxRate;

      // Update document with tax info
      await db.query(
        `UPDATE documents
         SET extracted_data = jsonb_set(extracted_data, '{tax}', $1::jsonb),
             extracted_data = jsonb_set(extracted_data, '{taxRate}', $2::jsonb),
             updated_at = NOW()
         WHERE id = $3`,
        [
          JSON.stringify(taxResult.taxAmount),
          JSON.stringify(taxResult.taxRate),
          documentId,
        ]
      );
    } catch (error) {
      logger.warn('Tax rule application failed, continuing without tax', {
        documentId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  // Get user who uploaded
  const userResult = await db.query<{ uploaded_by: string }>(
    'SELECT uploaded_by FROM documents WHERE id = $1',
    [documentId]
  );

  const uploadedBy = userResult.rows[0]?.uploaded_by;

  if (!uploadedBy) {
    throw new Error('Document has no uploader');
  }

  // Post to ledger
  await postDocumentToLedger(tenantId, documentId, uploadedBy);

  logger.info('Document auto-posted to ledger', { tenantId, documentId });
}
