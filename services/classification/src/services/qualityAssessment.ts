import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId } from '@ai-accountant/shared-types';

const logger = createLogger('classification-service');

export interface QualityIssue {
  type:
    | 'blurry'
    | 'incomplete'
    | 'low_resolution'
    | 'poor_contrast'
    | 'missing_fields'
    | 'unreadable';
  severity: 'low' | 'medium' | 'high';
  description: string;
  field?: string;
}

export interface QualityAssessment {
  documentId: DocumentId;
  overallScore: number; // 0-100
  qualityIssues: QualityIssue[];
  isAcceptable: boolean;
  recommendations: string[];
}

/**
 * Assess document quality (image quality, completeness, readability)
 */
export async function assessDocumentQuality(
  tenantId: TenantId,
  documentId: DocumentId
): Promise<QualityAssessment> {
  logger.info('Assessing document quality', { tenantId, documentId });

  // Get document details
  const docResult = await db.query<{
    id: string;
    file_type: string;
    file_size: number;
    extracted_data: Record<string, unknown> | null;
    confidence_score: number | null;
    quality_score: number | null;
    quality_issues: Record<string, unknown> | null;
  }>(
    `SELECT id, file_type, file_size, extracted_data, confidence_score, quality_score, quality_issues
     FROM documents
     WHERE id = $1 AND tenant_id = $2`,
    [documentId, tenantId]
  );

  if (docResult.rows.length === 0) {
    throw new Error('Document not found');
  }

  const document = docResult.rows[0]!;
  const extractedData = (document.extracted_data ?? {}) as Record<string, unknown>;
  const qualityIssues: QualityIssue[] = [];

  // Check confidence score
  const confidenceScore = document.confidence_score || 0;
  if (confidenceScore < 0.7) {
    qualityIssues.push({
      type: 'unreadable',
      severity: confidenceScore < 0.5 ? 'high' : 'medium',
      description: `Low OCR confidence: ${(confidenceScore * 100).toFixed(1)}%`,
    });
  }

  // Check for missing critical fields
  const requiredFields = ['total', 'date', 'vendor'];
  const missingFields = requiredFields.filter((field) => {
    const value = extractedData[field];
    if (value === null || value === undefined) {
      return true;
    }
    if (typeof value === 'string') {
      return value.trim() === '';
    }
    return false;
  });

  if (missingFields.length > 0) {
    const issue: QualityIssue = {
      type: 'missing_fields',
      severity: missingFields.length >= 2 ? 'high' : 'medium',
      description: `Missing required fields: ${missingFields.join(', ')}`,
    };
    const firstMissing = missingFields[0];
    if (firstMissing) {
      issue.field = firstMissing;
    }
    qualityIssues.push(issue);
  }

  // Check file size (very small files might be low quality)
  if (document.file_size < 10000) {
    // Less than 10KB
    qualityIssues.push({
      type: 'low_resolution',
      severity: 'medium',
      description: 'File size is very small, may indicate low resolution',
    });
  }

  // Check extracted data quality
  const totalRaw = extractedData.total;
  const total = typeof totalRaw === 'number' ? totalRaw : parseFloat(String(totalRaw ?? '0'));

  if (total <= 0) {
    qualityIssues.push({
      type: 'missing_fields',
      severity: 'high',
      description: 'Total amount is missing or invalid',
      field: 'total',
    });
  }

  // Check date validity
  const rawDate = extractedData.date;
  if (rawDate !== undefined) {
    const date = rawDate instanceof Date ? rawDate : new Date(String(rawDate));
    if (Number.isNaN(date.getTime())) {
      qualityIssues.push({
        type: 'missing_fields',
        severity: 'high',
        description: 'Date is invalid or unparseable',
        field: 'date',
      });
    }
  }

  // Use existing quality score if available
  let overallScore = document.quality_score || 100;

  // Deduct points for each issue
  for (const issue of qualityIssues) {
    const deduction = issue.severity === 'high' ? 20 : issue.severity === 'medium' ? 10 : 5;
    overallScore = Math.max(0, overallScore - deduction);
  }

  // Adjust based on confidence score
  overallScore = Math.min(overallScore, confidenceScore * 100);

  const isAcceptable =
    overallScore >= 70 && qualityIssues.filter((i) => i.severity === 'high').length === 0;

  // Generate recommendations
  const recommendations: string[] = [];
  if (overallScore < 70) {
    recommendations.push(
      'Document quality is below acceptable threshold. Consider re-uploading with better image quality.'
    );
  }
  if (missingFields.length > 0) {
    recommendations.push(`Please manually enter missing fields: ${missingFields.join(', ')}`);
  }
  if (confidenceScore < 0.7) {
    recommendations.push('OCR confidence is low. Please review and correct extracted data.');
  }
  if (qualityIssues.some((i) => i.type === 'low_resolution')) {
    recommendations.push(
      'Image resolution may be too low. Try scanning at a higher resolution (300 DPI recommended).'
    );
  }

  // Update document with quality assessment
  await db.query(
    `UPDATE documents
     SET quality_score = $1,
         quality_issues = $2::jsonb,
         updated_at = NOW()
     WHERE id = $3`,
    [overallScore, JSON.stringify(qualityIssues), documentId]
  );

  return {
    documentId,
    overallScore,
    qualityIssues,
    isAcceptable,
    recommendations,
  };
}
