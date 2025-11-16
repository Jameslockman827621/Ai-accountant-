import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId } from '@ai-accountant/shared-types';

const logger = createLogger('classification-service');

export interface DuplicateMatch {
  documentId: DocumentId;
  confidence: number;
  similarityScore: number;
  matchingFields: string[];
  differences: Array<{
    field: string;
    documentValue: unknown;
    duplicateValue: unknown;
  }>;
}

export interface DuplicateDetectionResult {
  documentId: DocumentId;
  isDuplicate: boolean;
  matches: DuplicateMatch[];
  recommendedAction: 'keep_both' | 'merge' | 'delete_duplicate' | 'review';
}

/**
 * ML-based duplicate detection for documents
 * Detects duplicate invoices, receipts, and other documents
 */
export async function detectDuplicates(
  tenantId: TenantId,
  documentId: DocumentId
): Promise<DuplicateDetectionResult> {
  logger.info('Detecting duplicates', { tenantId, documentId });

  // Get document details
  const docResult = await db.query<{
    id: string;
    document_type: string;
    extracted_data: Record<string, unknown> | null;
    created_at: Date;
  }>(
    `SELECT id, document_type, extracted_data, created_at
     FROM documents
     WHERE id = $1 AND tenant_id = $2`,
    [documentId, tenantId]
  );

  if (docResult.rows.length === 0) {
    throw new Error('Document not found');
  }

  const document = docResult.rows[0];
  const extractedData = document.extracted_data || {};

  // Get potential duplicates (same type, similar date, similar amount)
  const amount = typeof extractedData.total === 'number'
    ? extractedData.total
    : parseFloat(String(extractedData.total || '0'));
  const date = extractedData.date ? new Date(String(extractedData.date)) : document.created_at;
  const vendor = (extractedData.vendor as string) || '';

  // Find similar documents
  const similarDocs = await db.query<{
    id: string;
    extracted_data: Record<string, unknown> | null;
    created_at: Date;
    confidence_score: number | null;
  }>(
    `SELECT id, extracted_data, created_at, confidence_score
     FROM documents
     WHERE tenant_id = $1
       AND id != $2
       AND document_type = $3
       AND (
         ABS(EXTRACT(EPOCH FROM (created_at - $4::timestamp))) < 86400 * 7
         OR (extracted_data->>'date')::date BETWEEN $4::date - INTERVAL '7 days' AND $4::date + INTERVAL '7 days'
       )
     ORDER BY created_at DESC
     LIMIT 50`,
    [tenantId, documentId, document.document_type, date]
  );

  const matches: DuplicateMatch[] = [];

  for (const candidate of similarDocs.rows) {
    const candidateData = candidate.extracted_data || {};
    const candidateAmount = typeof candidateData.total === 'number'
      ? candidateData.total
      : parseFloat(String(candidateData.total || '0'));
    const candidateVendor = (candidateData.vendor as string) || '';

    // Calculate similarity
    let similarityScore = 0;
    const matchingFields: string[] = [];
    const differences: DuplicateMatch['differences'] = [];

    // Amount similarity (within 1% or exact match)
    const amountDiff = Math.abs(amount - candidateAmount);
    const amountSimilarity = amount > 0
      ? 1 - Math.min(amountDiff / amount, 1)
      : candidateAmount === amount ? 1 : 0;

    if (amountSimilarity > 0.99) {
      similarityScore += 0.4;
      matchingFields.push('amount');
    } else {
      differences.push({
        field: 'amount',
        documentValue: amount,
        duplicateValue: candidateAmount,
      });
    }

    // Vendor similarity (exact match or fuzzy)
    const vendorSimilarity = calculateStringSimilarity(vendor.toLowerCase(), candidateVendor.toLowerCase());
    if (vendorSimilarity > 0.8) {
      similarityScore += 0.3;
      matchingFields.push('vendor');
    } else if (vendor && candidateVendor) {
      differences.push({
        field: 'vendor',
        documentValue: vendor,
        duplicateValue: candidateVendor,
      });
    }

    // Date similarity (within 1 day)
    const candidateDate = candidateData.date ? new Date(String(candidateData.date)) : candidate.created_at;
    const dateDiff = Math.abs(date.getTime() - candidateDate.getTime());
    const dateSimilarity = dateDiff < 24 * 60 * 60 * 1000 ? 1 : 0;

    if (dateSimilarity > 0.9) {
      similarityScore += 0.2;
      matchingFields.push('date');
    } else {
      differences.push({
        field: 'date',
        documentValue: date.toISOString(),
        duplicateValue: candidateDate.toISOString(),
      });
    }

    // Description similarity
    const description = (extractedData.description as string) || '';
    const candidateDescription = (candidateData.description as string) || '';
    if (description && candidateDescription) {
      const descSimilarity = calculateStringSimilarity(description.toLowerCase(), candidateDescription.toLowerCase());
      if (descSimilarity > 0.7) {
        similarityScore += 0.1;
        matchingFields.push('description');
      }
    }

    // Consider duplicate if similarity > 0.8
    if (similarityScore > 0.8) {
      matches.push({
        documentId: candidate.id as DocumentId,
        confidence: similarityScore,
        similarityScore,
        matchingFields,
        differences,
      });
    }
  }

  // Sort by similarity score
  matches.sort((a, b) => b.similarityScore - a.similarityScore);

  const isDuplicate = matches.length > 0 && matches[0].similarityScore > 0.9;

  // Determine recommended action
  let recommendedAction: DuplicateDetectionResult['recommendedAction'] = 'review';
  if (isDuplicate && matches[0].similarityScore > 0.95) {
    recommendedAction = 'delete_duplicate';
  } else if (matches.length > 0 && matches[0].similarityScore > 0.85) {
    recommendedAction = 'merge';
  } else if (matches.length > 0) {
    recommendedAction = 'keep_both';
  }

  return {
    documentId,
    isDuplicate,
    matches,
    recommendedAction,
  };
}

/**
 * Calculate string similarity using Levenshtein distance
 */
function calculateStringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1;

  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1;

  const distance = levenshteinDistance(str1, str2);
  return (longer.length - distance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}
