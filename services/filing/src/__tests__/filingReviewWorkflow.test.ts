import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { db } from '@ai-accountant/database';
import {
  createFilingReview,
  getFilingReviewChecklist,
  approveFilingReview,
  rejectFilingReview,
} from '../services/filingReviewWorkflow';
import { TenantId, UserId } from '@ai-accountant/shared-types';

describe('FilingReviewWorkflow', () => {
  let testTenantId: TenantId;
  let testUserId: UserId;
  let testFilingId: string;

  beforeEach(async () => {
    // Create test tenant
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    testTenantId = tenantResult.rows[0]?.id as TenantId;

    // Create test user
    const userResult = await db.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, 'test@example.com', 'Test User', 'hash', 'client')
       RETURNING id`,
      [testTenantId]
    );
    testUserId = userResult.rows[0]?.id as UserId;

    // Create test filing
    const filingResult = await db.query<{ id: string }>(
      `INSERT INTO filings (tenant_id, filing_type, status, period_start, period_end, filing_data)
       VALUES ($1, 'vat', 'draft', '2024-01-01', '2024-01-31', '{"vatOutput": 1000, "vatInput": 200, "vatNet": 800}'::jsonb)
       RETURNING id`,
      [testTenantId]
    );
    testFilingId = filingResult.rows[0]?.id || '';

    // Create attestation
    await db.query(
      `INSERT INTO filing_attestations (id, filing_id, tenant_id, user_id, attested_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
      [testFilingId, testTenantId, testUserId]
    );
  });

  afterEach(async () => {
    if (testTenantId) {
      await db.query('DELETE FROM filing_reviews WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM filing_attestations WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM filings WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM users WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
  });

  it('should create a filing review', async () => {
    const reviewId = await createFilingReview(testFilingId, testTenantId, testUserId);

    expect(reviewId).toBeDefined();

    const filingResult = await db.query<{ status: string }>(
      'SELECT status FROM filings WHERE id = $1',
      [testFilingId]
    );
    expect(filingResult.rows[0]?.status).toBe('pending_approval');
  });

  it('should get filing review checklist', async () => {
    await createFilingReview(testFilingId, testTenantId, testUserId);

    const checklist = await getFilingReviewChecklist(testFilingId, testTenantId);

    expect(checklist.checks.length).toBeGreaterThan(0);
    expect(checklist.canApprove).toBeDefined();
    expect(checklist.canReject).toBe(true);
  });

  it('should approve a filing review', async () => {
    const reviewId = await createFilingReview(testFilingId, testTenantId, testUserId);

    await approveFilingReview(reviewId, testTenantId, testUserId, 'Approved');

    const reviewResult = await db.query<{ review_status: string }>(
      'SELECT review_status FROM filing_reviews WHERE id = $1',
      [reviewId]
    );
    expect(reviewResult.rows[0]?.review_status).toBe('approved');
  });

  it('should reject a filing review', async () => {
    const reviewId = await createFilingReview(testFilingId, testTenantId, testUserId);

    await rejectFilingReview(reviewId, testTenantId, testUserId, 'Rejected', []);

    const reviewResult = await db.query<{ review_status: string }>(
      'SELECT review_status FROM filing_reviews WHERE id = $1',
      [reviewId]
    );
    expect(reviewResult.rows[0]?.review_status).toBe('rejected');
  });
});
