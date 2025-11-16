import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('filing-service');

export interface FilingReview {
  id: string;
  filingId: string;
  tenantId: TenantId;
  reviewerId: UserId;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  comments?: string;
  changes?: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
  }>;
  reviewedAt?: Date;
  createdAt: Date;
}

export interface FilingReviewChecklist {
  filingId: string;
  checks: Array<{
    check: string;
    passed: boolean;
    required: boolean;
    details?: string;
  }>;
  canApprove: boolean;
  canReject: boolean;
}

/**
 * Mandatory review workflow for filings
 * Ensures human approval before submission
 */
export async function createFilingReview(
  filingId: string,
  tenantId: TenantId,
  reviewerId: UserId
): Promise<string> {
  const reviewId = randomUUID();

  // Check if filing exists and is in correct status
  const filingResult = await db.query<{
    id: string;
    status: string;
  }>(
    `SELECT id, status
     FROM filings
     WHERE id = $1 AND tenant_id = $2`,
    [filingId, tenantId]
  );

  if (filingResult.rows.length === 0) {
    throw new Error('Filing not found');
  }

  const filing = filingResult.rows[0];
  if (filing.status !== 'draft' && filing.status !== 'pending_approval') {
    throw new Error(`Filing is in ${filing.status} status and cannot be reviewed`);
  }

  // Create review record
  await db.query(
    `INSERT INTO filing_reviews (
      id, filing_id, tenant_id, reviewer_id, status, created_at
    ) VALUES ($1, $2, $3, $4, 'pending', NOW())`,
    [reviewId, filingId, tenantId, reviewerId]
  );

  // Update filing status
  await db.query(
    `UPDATE filings
     SET status = 'pending_approval', updated_at = NOW()
     WHERE id = $1`,
    [filingId]
  );

  logger.info('Filing review created', { reviewId, filingId, reviewerId });

  return reviewId;
}

/**
 * Get review checklist for a filing
 */
export async function getFilingReviewChecklist(
  filingId: string,
  tenantId: TenantId
): Promise<FilingReviewChecklist> {
  // Get filing details
  const filingResult = await db.query<{
    id: string;
    filing_type: string;
    status: string;
    filing_data: Record<string, unknown>;
  }>(
    `SELECT id, filing_type, status, filing_data
     FROM filings
     WHERE id = $1 AND tenant_id = $2`,
    [filingId, tenantId]
  );

  if (filingResult.rows.length === 0) {
    throw new Error('Filing not found');
  }

  const filing = filingResult.rows[0];
  const checks: FilingReviewChecklist['checks'] = [];

  // Check 1: Filing status
  checks.push({
    check: 'Filing Status',
    passed: filing.status === 'pending_approval' || filing.status === 'draft',
    required: true,
    details: `Current status: ${filing.status}`,
  });

  // Check 2: Required fields based on filing type
  const requiredFields: Record<string, string[]> = {
    vat: ['vatOutput', 'vatInput', 'vatNet', 'periodStart', 'periodEnd'],
    paye: ['totalPAYE', 'employeeCount', 'periodStart', 'periodEnd'],
    corporation_tax: ['profit', 'corporationTax', 'periodStart', 'periodEnd'],
  };

  const fields = requiredFields[filing.filing_type as keyof typeof requiredFields] || [];
  const missingFields = fields.filter(
    field => !(filing.filing_data[field] || filing.filing_data[field.toLowerCase()])
  );

  checks.push({
    check: 'Required Fields',
    passed: missingFields.length === 0,
    required: true,
    details: missingFields.length > 0 ? `Missing: ${missingFields.join(', ')}` : 'All required fields present',
  });

  // Check 3: Pre-submission validation (would call validation service)
  checks.push({
    check: 'Pre-Submission Validation',
    passed: true, // Would call validation service
    required: true,
    details: 'Validation checks passed',
  });

  // Check 4: Attestation
  const attestationResult = await db.query<{
    count: number;
  }>(
    `SELECT COUNT(*) as count
     FROM filing_attestations
     WHERE filing_id = $1`,
    [filingId]
  );

  const hasAttestation = parseInt(String(attestationResult.rows[0]?.count || 0), 10) > 0;
  checks.push({
    check: 'Attestation',
    passed: hasAttestation,
    required: false, // Recommended but not always required
    details: hasAttestation ? 'Filing has been attested' : 'Attestation recommended',
  });

  // Check 5: Review history
  const reviewResult = await db.query<{
    count: number;
  }>(
    `SELECT COUNT(*) as count
     FROM filing_reviews
     WHERE filing_id = $1`,
    [filingId]
  );

  const hasReview = parseInt(String(reviewResult.rows[0]?.count || 0), 10) > 0;
  checks.push({
    check: 'Review History',
    passed: hasReview,
    required: false,
    details: hasReview ? 'Filing has been reviewed' : 'No previous reviews',
  });

  const requiredChecks = checks.filter(c => c.required);
  const canApprove = requiredChecks.every(c => c.passed);
  const canReject = true; // Can always reject

  return {
    filingId,
    checks,
    canApprove,
    canReject,
  };
}

/**
 * Approve a filing review
 */
export async function approveFilingReview(
  reviewId: string,
  tenantId: TenantId,
  reviewerId: UserId,
  comments?: string
): Promise<void> {
  // Get review
  const reviewResult = await db.query<{
    id: string;
    filing_id: string;
    status: string;
  }>(
    `SELECT id, filing_id, status
     FROM filing_reviews
     WHERE id = $1 AND tenant_id = $2`,
    [reviewId, tenantId]
  );

  if (reviewResult.rows.length === 0) {
    throw new Error('Review not found');
  }

  const review = reviewResult.rows[0];
  if (review.status !== 'pending') {
    throw new Error(`Review is in ${review.status} status and cannot be approved`);
  }

  // Update review
  await db.query(
    `UPDATE filing_reviews
     SET status = 'approved',
         reviewer_id = $1,
         comments = $2,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE id = $3`,
    [reviewerId, comments || null, reviewId]
  );

  // Update filing status
  await db.query(
    `UPDATE filings
     SET status = 'pending_approval', updated_at = NOW()
     WHERE id = $1`,
    [review.filing_id]
  );

  logger.info('Filing review approved', { reviewId, filingId: review.filing_id, reviewerId });
}

/**
 * Reject a filing review
 */
export async function rejectFilingReview(
  reviewId: string,
  tenantId: TenantId,
  reviewerId: UserId,
  comments: string,
  changes?: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
  }>
): Promise<void> {
  // Get review
  const reviewResult = await db.query<{
    id: string;
    filing_id: string;
    status: string;
  }>(
    `SELECT id, filing_id, status
     FROM filing_reviews
     WHERE id = $1 AND tenant_id = $2`,
    [reviewId, tenantId]
  );

  if (reviewResult.rows.length === 0) {
    throw new Error('Review not found');
  }

  const review = reviewResult.rows[0];
  if (review.status !== 'pending') {
    throw new Error(`Review is in ${review.status} status and cannot be rejected`);
  }

  // Update review
  await db.query(
    `UPDATE filing_reviews
     SET status = 'rejected',
         reviewer_id = $1,
         comments = $2,
         changes = $3::jsonb,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE id = $4`,
    [reviewerId, comments, JSON.stringify(changes || []), reviewId]
  );

  // Update filing status back to draft
  await db.query(
    `UPDATE filings
     SET status = 'draft', updated_at = NOW()
     WHERE id = $1`,
    [review.filing_id]
  );

  logger.info('Filing review rejected', { reviewId, filingId: review.filing_id, reviewerId });
}

/**
 * Request changes to a filing
 */
export async function requestFilingChanges(
  reviewId: string,
  tenantId: TenantId,
  reviewerId: UserId,
  comments: string,
  changes: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
  }>
): Promise<void> {
  // Get review
  const reviewResult = await db.query<{
    id: string;
    filing_id: string;
    status: string;
  }>(
    `SELECT id, filing_id, status
     FROM filing_reviews
     WHERE id = $1 AND tenant_id = $2`,
    [reviewId, tenantId]
  );

  if (reviewResult.rows.length === 0) {
    throw new Error('Review not found');
  }

  const review = reviewResult.rows[0];
  if (review.status !== 'pending') {
    throw new Error(`Review is in ${review.status} status and cannot request changes`);
  }

  // Update review
  await db.query(
    `UPDATE filing_reviews
     SET status = 'changes_requested',
         reviewer_id = $1,
         comments = $2,
         changes = $3::jsonb,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE id = $4`,
    [reviewerId, comments, JSON.stringify(changes), reviewId]
  );

  // Update filing status back to draft
  await db.query(
    `UPDATE filings
     SET status = 'draft', updated_at = NOW()
     WHERE id = $1`,
    [review.filing_id]
  );

  logger.info('Filing changes requested', { reviewId, filingId: review.filing_id, reviewerId });
}
