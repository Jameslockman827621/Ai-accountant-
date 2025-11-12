import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId, FilingId } from '@ai-accountant/shared-types';
// Note: In production, this would import from validation service
// For now, we'll use a local validation call
async function validateTaxCalculation(
  tenantId: string,
  filingType: string,
  filingData: Record<string, unknown>
): Promise<{ isValid: boolean; errors: string[]; warnings: string[]; confidence: number }> {
  // This would call the validation service API
  // For now, return a basic validation
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (filingType === 'vat') {
    const totalVatDue = (filingData.totalVatDue as number) || 0;
    const vatDueSales = (filingData.vatDueSales as number) || 0;
    const vatDueAcquisitions = (filingData.vatDueAcquisitions as number) || 0;
    
    if (Math.abs((vatDueSales + vatDueAcquisitions) - totalVatDue) > 0.01) {
      errors.push('VAT calculation mismatch');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    confidence: errors.length === 0 ? 0.9 : 0.5,
  };
}

const logger = createLogger('filing-service');

export interface FilingReviewChecklist {
  taxCalculationValid: boolean;
  dataAccuracyChecked: boolean;
  anomaliesReviewed: boolean;
  confidenceThresholdsMet: boolean;
  allChecksPassed: boolean;
  errors: string[];
  warnings: string[];
}

export async function createFilingReview(
  filingId: FilingId,
  tenantId: TenantId,
  reviewerId: UserId
): Promise<string> {
  const reviewId = crypto.randomUUID();

  // Get filing
  const filingResult = await db.query<{
    filing_type: string;
    filing_data: Record<string, unknown>;
    status: string;
  }>(
    'SELECT filing_type, filing_data, status FROM filings WHERE id = $1 AND tenant_id = $2',
    [filingId, tenantId]
  );

  if (filingResult.rows.length === 0) {
    throw new Error('Filing not found');
  }

  const filing = filingResult.rows[0];

  if (filing.status !== 'draft') {
    throw new Error('Filing must be in draft status to create review');
  }

  // Run validation
  const validationResult = await validateTaxCalculation(
    tenantId,
    filing.filing_type,
    filing.filing_data
  );

  // Create review
  await db.query(
    `INSERT INTO filing_reviews (
      id, filing_id, reviewer_id, review_status, validation_results, created_at, updated_at
    ) VALUES ($1, $2, $3, 'pending', $4::jsonb, NOW(), NOW())`,
    [
      reviewId,
      filingId,
      reviewerId,
      JSON.stringify({
        isValid: validationResult.isValid,
        errors: validationResult.errors,
        warnings: validationResult.warnings,
        confidence: validationResult.confidence,
      }),
    ]
  );

  // Update filing status
  await db.query(
    'UPDATE filings SET status = $1, updated_at = NOW() WHERE id = $2',
    ['pending_approval', filingId]
  );

  logger.info('Filing review created', { reviewId, filingId, tenantId });
  return reviewId;
}

export async function getFilingReviewChecklist(
  filingId: FilingId,
  tenantId: TenantId
): Promise<FilingReviewChecklist> {
  // Get filing
  const filingResult = await db.query<{
    filing_type: string;
    filing_data: Record<string, unknown>;
    period_start: Date;
    period_end: Date;
  }>(
    'SELECT filing_type, filing_data, period_start, period_end FROM filings WHERE id = $1 AND tenant_id = $2',
    [filingId, tenantId]
  );

  if (filingResult.rows.length === 0) {
    throw new Error('Filing not found');
  }

  const filing = filingResult.rows[0];

  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Validate tax calculation
  const taxValidation = await validateTaxCalculation(
    tenantId,
    filing.filing_type,
    filing.filing_data
  );
  const taxCalculationValid = taxValidation.isValid;
  if (!taxValidation.isValid) {
    errors.push(...taxValidation.errors);
  }
  warnings.push(...taxValidation.warnings);

  // 2. Check data accuracy (simplified - would call validation service)
  const dataAccuracyChecked = true; // Placeholder

  // 3. Check for anomalies (simplified - would call validation service)
  const anomaliesReviewed = true; // Placeholder

  // 4. Check confidence thresholds (simplified - would call validation service)
  const confidenceThresholdsMet = taxValidation.confidence >= 0.85;

  const allChecksPassed = taxCalculationValid && dataAccuracyChecked && anomaliesReviewed && confidenceThresholdsMet;

  return {
    taxCalculationValid,
    dataAccuracyChecked,
    anomaliesReviewed,
    confidenceThresholdsMet,
    allChecksPassed,
    errors,
    warnings,
  };
}

export async function approveFilingReview(
  reviewId: string,
  reviewerId: UserId,
  notes?: string
): Promise<void> {
  const reviewResult = await db.query<{
    filing_id: string;
  }>(
    'SELECT filing_id FROM filing_reviews WHERE id = $1 AND reviewer_id = $2',
    [reviewId, reviewerId]
  );

  if (reviewResult.rows.length === 0) {
    throw new Error('Review not found or not authorized');
  }

  const filingId = reviewResult.rows[0].filing_id;

  // Update review
  await db.query(
    `UPDATE filing_reviews
     SET review_status = 'approved',
         review_notes = $1,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE id = $2`,
    [notes || null, reviewId]
  );

  // Update filing status
  await db.query(
    'UPDATE filings SET status = $1, updated_at = NOW() WHERE id = $2',
    ['pending_approval', filingId]
  );

  logger.info('Filing review approved', { reviewId, filingId, reviewerId });
}

export async function rejectFilingReview(
  reviewId: string,
  reviewerId: UserId,
  reason: string
): Promise<void> {
  const reviewResult = await db.query<{
    filing_id: string;
  }>(
    'SELECT filing_id FROM filing_reviews WHERE id = $1 AND reviewer_id = $2',
    [reviewId, reviewerId]
  );

  if (reviewResult.rows.length === 0) {
    throw new Error('Review not found or not authorized');
  }

  const filingId = reviewResult.rows[0].filing_id;

  // Update review
  await db.query(
    `UPDATE filing_reviews
     SET review_status = 'rejected',
         review_notes = $1,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE id = $2`,
    [reason, reviewId]
  );

  // Update filing status back to draft
  await db.query(
    'UPDATE filings SET status = $1, updated_at = NOW() WHERE id = $2',
    ['draft', filingId]
  );

  logger.info('Filing review rejected', { reviewId, filingId, reviewerId, reason });
}
