import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId } from '@ai-accountant/shared-types';
import { detectDuplicates } from './duplicateDetection';

const logger = createLogger('document-ingest-service');

export interface DuplicateMatch {
  documentId: DocumentId;
  similarity: number;
  matchType: 'exact' | 'near' | 'fuzzy';
  confidence: number;
  matchedFields: string[];
  reasons: string[];
}

/**
 * Advanced duplicate detection with similarity scoring
 */
export async function detectDuplicatesAdvanced(
  tenantId: TenantId,
  documentId: DocumentId
): Promise<DuplicateMatch[]> {
  logger.info('Advanced duplicate detection', { tenantId, documentId });

  // Get document
  const docResult = await db.query<{
    file_name: string;
    extracted_data: unknown;
    created_at: Date;
    file_size: number;
  }>(
    'SELECT file_name, extracted_data, created_at, file_size FROM documents WHERE id = $1 AND tenant_id = $2',
    [documentId, tenantId]
  );

  if (docResult.rows.length === 0) {
    return [];
  }

  const doc = docResult.rows[0];
  const extracted = doc.extracted_data as Record<string, unknown> | null;

  // Get all other documents
  const allDocs = await db.query<{
    id: string;
    file_name: string;
    extracted_data: unknown;
    created_at: Date;
    file_size: number;
  }>(
    `SELECT id, file_name, extracted_data, created_at, file_size
     FROM documents
     WHERE tenant_id = $1 AND id != $2`,
    [tenantId, documentId]
  );

  const matches: DuplicateMatch[] = [];

  for (const candidate of allDocs.rows) {
    const similarity = calculateDocumentSimilarity(doc, candidate);
    
    if (similarity.overall > 0.7) {
      matches.push({
        documentId: candidate.id,
        similarity: similarity.overall,
        matchType: similarity.overall > 0.95 ? 'exact' : similarity.overall > 0.85 ? 'near' : 'fuzzy',
        confidence: similarity.overall,
        matchedFields: similarity.matchedFields,
        reasons: generateMatchReasons(doc, candidate, similarity),
      });
    }
  }

  return matches.sort((a, b) => b.similarity - a.similarity);
}

function calculateDocumentSimilarity(
  doc1: { file_name: string; extracted_data: unknown; created_at: Date; file_size: number },
  doc2: { file_name: string; extracted_data: unknown; created_at: Date; file_size: number }
): {
  overall: number;
  fileName: number;
  extracted: number;
  date: number;
  size: number;
  matchedFields: string[];
} {
  // File name similarity
  const fileNameSim = levenshteinSimilarity(doc1.file_name.toLowerCase(), doc2.file_name.toLowerCase());

  // Extracted data similarity
  const ext1 = doc1.extracted_data as Record<string, unknown> | null;
  const ext2 = doc2.extracted_data as Record<string, unknown> | null;
  let extractedSim = 0;
  const matchedFields: string[] = [];

  if (ext1 && ext2) {
    const fields = ['total', 'date', 'vendor', 'invoiceNumber'];
    let matchCount = 0;
    
    fields.forEach(field => {
      const val1 = ext1[field];
      const val2 = ext2[field];
      if (val1 && val2) {
        if (typeof val1 === 'number' && typeof val2 === 'number') {
          if (Math.abs(val1 - val2) < 0.01) {
            matchCount++;
            matchedFields.push(field);
          }
        } else if (String(val1).toLowerCase() === String(val2).toLowerCase()) {
          matchCount++;
          matchedFields.push(field);
        }
      }
    });

    extractedSim = fields.length > 0 ? matchCount / fields.length : 0;
  }

  // Date similarity
  const dateDiff = Math.abs(doc1.created_at.getTime() - doc2.created_at.getTime()) / (1000 * 60 * 60 * 24);
  const dateSim = dateDiff === 0 ? 1.0 : dateDiff <= 1 ? 0.9 : dateDiff <= 7 ? 0.7 : 0.3;

  // Size similarity
  const sizeDiff = Math.abs(doc1.file_size - doc2.file_size);
  const sizeSim = sizeDiff === 0 ? 1.0 : sizeDiff < doc1.file_size * 0.01 ? 0.9 : 0.5;

  // Weighted overall similarity
  const overall = (fileNameSim * 0.2) + (extractedSim * 0.5) + (dateSim * 0.2) + (sizeSim * 0.1);

  return {
    overall,
    fileName: fileNameSim,
    extracted: extractedSim,
    date: dateSim,
    size: sizeSim,
    matchedFields,
  };
}

function levenshteinSimilarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  const distance = levenshteinDistance(str1, str2);
  return 1 - (distance / maxLen);
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

function generateMatchReasons(
  doc1: { file_name: string; extracted_data: unknown; created_at: Date },
  doc2: { file_name: string; extracted_data: unknown; created_at: Date },
  similarity: { fileName: number; extracted: number; date: number; matchedFields: string[] }
): string[] {
  const reasons: string[] = [];

  if (similarity.fileName > 0.9) {
    reasons.push('Very similar file names');
  }

  if (similarity.extracted > 0.8) {
    reasons.push(`Matching fields: ${similarity.matchedFields.join(', ')}`);
  }

  if (similarity.date > 0.9) {
    reasons.push('Same or very close dates');
  }

  return reasons;
}
