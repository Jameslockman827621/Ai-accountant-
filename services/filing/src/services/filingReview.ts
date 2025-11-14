import crypto from 'crypto';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId, FilingId, FilingStatus } from '@ai-accountant/shared-types';
import {
  runValidationSuite,
  ValidationSuiteSummary,
} from '@ai-accountant/validation-service/services/validationSummary';

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

async function executeValidationSummary(params: {
  tenantId: TenantId;
  filingId: FilingId;
  filingType: string;
  filingData: Record<string, unknown>;
  periodStart: Date;
  periodEnd: Date;
}): Promise<ValidationSuiteSummary> {
  return runValidationSuite({
    tenantId: params.tenantId,
    entityType: 'filing',
    entityId: params.filingId,
    filingType: params.filingType,
    filingData: params.filingData,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    includeConfidenceChecks: true,
  });
}

export async function createFilingReview(
  filingId: FilingId,
  tenantId: TenantId,
  reviewerId: UserId
): Promise<string> {
  const reviewId = crypto.randomUUID();

  const filingResult = await db.query<{
    filing_type: string;
    filing_data: Record<string, unknown>;
    status: string;
    period_start: Date;
    period_end: Date;
  }>(
    'SELECT filing_type, filing_data, status, period_start, period_end FROM filings WHERE id = $1 AND tenant_id = $2',
    [filingId, tenantId]
  );

  if (filingResult.rows.length === 0) {
    throw new Error('Filing not found');
  }

  const filing = filingResult.rows[0];

  if (filing.status !== FilingStatus.DRAFT) {
    throw new Error('Filing must be in draft status to create review');
  }

  const attestationResult = await db.query<{ id: string }>(
    'SELECT id FROM filing_attestations WHERE filing_id = $1 AND tenant_id = $2',
    [filingId, tenantId]
  );

  if (attestationResult.rows.length === 0) {
    throw new Error('Filing must be attested before requesting a review');
  }

  const summary = await executeValidationSummary({
    tenantId,
    filingId,
    filingType: filing.filing_type,
    filingData: filing.filing_data,
    periodStart: new Date(filing.period_start),
    periodEnd: new Date(filing.period_end),
  });

  await db.query(
    `INSERT INTO filing_reviews (
      id, filing_id, reviewer_id, review_status, validation_results, created_at, updated_at
    ) VALUES ($1, $2, $3, 'pending', $4::jsonb, NOW(), NOW())`,
    [reviewId, filingId, reviewerId, JSON.stringify(summary)]
  );

  await db.query(
    'UPDATE filings SET status = $1, updated_at = NOW() WHERE id = $2',
    [FilingStatus.PENDING_APPROVAL, filingId]
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

  const summary = await executeValidationSummary({
    tenantId,
    filingId,
    filingType: filing.filing_type,
    filingData: filing.filing_data,
    periodStart: new Date(filing.period_start),
    periodEnd: new Date(filing.period_end),
  });

  const taxCalculationValid = summary.components.tax?.isValid ?? false;
  const dataAccuracyChecked = Boolean(summary.components.accuracy);
  const accuracyPassed =
    (summary.components.accuracy?.failed.length ?? 0) === 0 && dataAccuracyChecked;
  const anomaliesReviewed = Boolean(summary.components.anomalies);
  const anomaliesPassed = (summary.components.anomalies?.highestSeverity ?? 'none') === 'none';
  const confidenceThresholdsMet =
    summary.components.confidence?.requiresReview.length === 0 ?? true;

  return {
    taxCalculationValid,
    dataAccuracyChecked: accuracyPassed,
    anomaliesReviewed: anomaliesReviewed && anomaliesPassed,
    confidenceThresholdsMet,
    allChecksPassed:
      summary.status === 'pass' &&
      taxCalculationValid &&
      accuracyPassed &&
      anomaliesReviewed &&
      confidenceThresholdsMet,
    errors: summary.errors,
    warnings: summary.warnings,
  };
}

export async function approveFilingReview(
  reviewId: string,
  reviewerId: UserId,
  notes?: string
): Promise<void> {
    const reviewResult = await db.query<{
      filing_id: string;
      review_status: string;
      validation_results: ValidationSuiteSummary | null;
    }>(
      'SELECT filing_id, review_status, validation_results FROM filing_reviews WHERE id = $1 AND reviewer_id = $2',
      [reviewId, reviewerId]
    );

  if (reviewResult.rows.length === 0) {
    throw new Error('Review not found or not authorized');
  }

    const review = reviewResult.rows[0];
    const filingId = review.filing_id;

    if (review.review_status !== 'pending') {
      throw new Error('Review has already been processed');
    }

    if (review.validation_results?.status === 'fail') {
      throw new Error('Validation checks failed. Please resolve issues before approval.');
    }

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
      [FilingStatus.PENDING_APPROVAL, filingId]
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
      review_status: string;
    }>(
      'SELECT filing_id, review_status FROM filing_reviews WHERE id = $1 AND reviewer_id = $2',
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
      [FilingStatus.DRAFT, filingId]
    );

  logger.info('Filing review rejected', { reviewId, filingId, reviewerId, reason });
}
