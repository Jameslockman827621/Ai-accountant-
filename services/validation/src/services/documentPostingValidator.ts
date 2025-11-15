import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { DocumentId, DocumentStatus, DocumentType, TenantId } from '@ai-accountant/shared-types';
import { MIN_CONFIDENCE_THRESHOLD } from './confidenceThreshold';

const logger = createLogger('validation-service');

export interface NormalizedDocumentData {
  total: number;
  tax: number;
  date: Date;
  vendor: string;
  description: string;
  taxRate?: number;
  documentType: DocumentType | string | null;
}

export interface DocumentPostingValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  normalizedData?: NormalizedDocumentData;
}

const parseNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

export async function validateDocumentForPosting(
  tenantId: TenantId,
  documentId: DocumentId
): Promise<DocumentPostingValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const docResult = await db.query<{
    id: string;
    document_type: DocumentType | string | null;
    status: DocumentStatus;
    extracted_data: Record<string, unknown> | null;
    confidence_score: number | null;
  }>(
    `SELECT id, document_type, status, extracted_data, confidence_score
     FROM documents
     WHERE id = $1 AND tenant_id = $2`,
    [documentId, tenantId]
  );

  if (docResult.rows.length === 0) {
    return {
      isValid: false,
      errors: ['Document not found'],
      warnings,
    };
  }

  const document = docResult.rows[0];

  if (
    document.status !== DocumentStatus.CLASSIFIED &&
    document.status !== DocumentStatus.EXTRACTED
  ) {
    errors.push(`Document is in ${document.status} state and cannot be posted`);
  }

  if ((document.confidence_score || 0) < MIN_CONFIDENCE_THRESHOLD) {
    errors.push('Confidence below threshold; manual review required');
  }

  const extractedData = document.extracted_data || {};
  const total = parseNumber(extractedData.total);
  const tax = parseNumber(extractedData.tax);
  const vendor = typeof extractedData.vendor === 'string' && extractedData.vendor.trim().length > 0
    ? extractedData.vendor.trim()
    : 'Unknown Vendor';
  const description = typeof extractedData.description === 'string' && extractedData.description.trim().length > 0
    ? extractedData.description.trim()
    : `${document.document_type || 'Document'} from ${vendor}`;
  const taxRate = total > 0 ? tax / total : undefined;

  if (!extractedData.total) {
    errors.push('Missing total amount');
  } else if (total <= 0) {
    errors.push('Total amount must be greater than zero');
  }

  if (!extractedData.date) {
    errors.push('Missing document date');
  }

  const parsedDate = extractedData.date ? new Date(String(extractedData.date)) : new Date();
  if (Number.isNaN(parsedDate.getTime())) {
    errors.push('Invalid document date');
  }

  if (tax < 0) {
    warnings.push('Tax amount is negative');
  }
  if (tax > total) {
    errors.push('Tax amount exceeds total amount');
  }

  // Duplicate detection (same amount, vendor, and date)
  if (total > 0 && extractedData.date) {
    const duplicateResult = await db.query<{ id: string }>(
      `SELECT id
       FROM documents
       WHERE tenant_id = $1
         AND id <> $2
         AND document_type = $3
         AND COALESCE(extracted_data->>'vendor', '') ILIKE $4
         AND extracted_data->>'date' = $5
         AND CAST(extracted_data->>'total' AS numeric) = $6
       LIMIT 1`,
      [
        tenantId,
        documentId,
        document.document_type,
        vendor,
        String(extractedData.date),
        total,
      ]
    );

    if (duplicateResult.rows.length > 0) {
      warnings.push('Possible duplicate document detected');
    }
  }

  const isValid = errors.length === 0;

  if (warnings.length > 0) {
    logger.warn('Document validation warnings', {
      documentId,
      warnings,
    });
  }

  return {
    isValid,
    errors,
    warnings,
    normalizedData: isValid
      ? {
          total,
          tax,
          date: parsedDate,
          vendor,
          description,
          taxRate,
          documentType: document.document_type,
        }
      : undefined,
  };
}
