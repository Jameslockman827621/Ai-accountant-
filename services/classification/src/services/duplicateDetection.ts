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

  const document = docResult.rows[0]!;
  const extractedData = document.extracted_data || {};

  // Get potential duplicates (same type, similar date, similar amount)
  const amount =
    typeof extractedData.total === 'number'
      ? extractedData.total
      : parseFloat(String(extractedData.total || '0'));
  const date = extractedData.date ? new Date(String(extractedData.date)) : document.created_at;
  const vendor = typeof extractedData.vendor === 'string' ? extractedData.vendor : '';

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
    const candidateAmount =
      typeof candidateData.total === 'number'
        ? candidateData.total
        : parseFloat(String(candidateData.total || '0'));
    const candidateVendor = typeof candidateData.vendor === 'string' ? candidateData.vendor : '';

    // Calculate similarity
    let similarityScore = 0;
    const matchingFields: string[] = [];
    const differences: DuplicateMatch['differences'] = [];

    // Amount similarity (within 1% or exact match)
    const amountDiff = Math.abs(amount - candidateAmount);
    const amountSimilarity =
      amount > 0 ? 1 - Math.min(amountDiff / amount, 1) : candidateAmount === amount ? 1 : 0;

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
    const vendorSimilarity = calculateStringSimilarity(
      vendor.toLowerCase(),
      candidateVendor.toLowerCase()
    );
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
    const candidateDate = candidateData.date
      ? new Date(String(candidateData.date))
      : candidate.created_at;
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
    const description =
      typeof extractedData.description === 'string' ? extractedData.description : '';
    const candidateDescription =
      typeof candidateData.description === 'string' ? candidateData.description : '';
    if (description && candidateDescription) {
      const descSimilarity = calculateStringSimilarity(
        description.toLowerCase(),
        candidateDescription.toLowerCase()
      );
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

  const topMatch = matches[0];
  const isDuplicate = Boolean(topMatch && topMatch.similarityScore > 0.9);

  // Determine recommended action
  let recommendedAction: DuplicateDetectionResult['recommendedAction'] = 'review';
  if (topMatch && topMatch.similarityScore > 0.95) {
    recommendedAction = 'delete_duplicate';
  } else if (topMatch && topMatch.similarityScore > 0.85) {
    recommendedAction = 'merge';
  } else if (topMatch) {
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

  if (longer.length === 0) return 1;

  const distance = levenshteinDistance(str1, str2);
  return (longer.length - distance) / longer.length;
}

function levenshteinDistance(str1: string, str2: string): number {
  if (str1 === str2) {
    return 0;
  }
  if (str1.length === 0) {
    return str2.length;
  }
  if (str2.length === 0) {
    return str1.length;
  }

  let previousRow = Array.from({ length: str2.length + 1 }, (_, idx) => idx);
  let currentRow = new Array<number>(str2.length + 1).fill(0);

  for (let i = 1; i <= str1.length; i++) {
    currentRow[0] = i;
    for (let j = 1; j <= str2.length; j++) {
      const cost = str1.charAt(i - 1) === str2.charAt(j - 1) ? 0 : 1;
      const deletion = previousRow[j]! + 1;
      const insertion = currentRow[j - 1]! + 1;
      const substitution = previousRow[j - 1]! + cost;
      currentRow[j] = Math.min(deletion, insertion, substitution);
    }
    [previousRow, currentRow] = [currentRow, previousRow];
  }

  return previousRow[str2.length] ?? 0;
}
