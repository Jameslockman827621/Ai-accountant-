import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';
import { crossValidateData } from '../../services/validation/src/services/crossValidationEngine';
import { createFilingReview, approveFilingReview, getFilingReviewChecklist } from '../../services/filing/src/services/filingReviewWorkflow';
import { detectDuplicates } from '../../services/classification/src/services/duplicateDetection';
import { assessDocumentQuality } from '../../services/classification/src/services/qualityAssessment';
import { routeToReviewQueue } from '../../services/classification/src/services/reviewQueueManager';
import { checkConnectionHealth } from '../../services/bank-feed/src/services/connectionHealthMonitor';
import { TenantId, UserId } from '@ai-accountant/shared-types';

describe('World-Class Workflows E2E Tests', () => {
  let testTenantId: TenantId;
  let testUserId: UserId;
  let testDocumentId: string;
  let testFilingId: string;

  beforeAll(async () => {
    // Create test tenant
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('E2E Test Tenant', 'GB', 'sme')
       RETURNING id`
    );
    testTenantId = tenantResult.rows[0]?.id as TenantId;

    // Create test user
    const userResult = await db.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, 'e2e@example.com', 'E2E Test User', 'hash', 'client')
       RETURNING id`,
      [testTenantId]
    );
    testUserId = userResult.rows[0]?.id as UserId;

    // Create test document
    const docResult = await db.query<{ id: string }>(
      `INSERT INTO documents (tenant_id, file_name, file_type, file_size, status, confidence_score, extracted_data)
       VALUES ($1, 'test-invoice.pdf', 'application/pdf', 1024, 'classified', 0.85, '{"total": 100, "date": "2024-01-15", "vendor": "Test Vendor"}'::jsonb)
       RETURNING id`,
      [testTenantId]
    );
    testDocumentId = docResult.rows[0]?.id || '';

    // Create test filing
    const filingResult = await db.query<{ id: string }>(
      `INSERT INTO filings (tenant_id, filing_type, status, period_start, period_end, filing_data)
       VALUES ($1, 'vat', 'draft', '2024-01-01', '2024-01-31', '{"vatOutput": 1000, "vatInput": 200, "vatNet": 800}'::jsonb)
       RETURNING id`,
      [testTenantId]
    );
    testFilingId = filingResult.rows[0]?.id || '';
  });

  afterAll(async () => {
    if (testTenantId) {
      await db.query('DELETE FROM filing_reviews WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM document_review_queue WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM documents WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM filings WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM users WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
    await db.close();
  });

  describe('Document Quality Control Workflow', () => {
    it('should assess document quality and route to review queue', async () => {
      // Assess quality
      const assessment = await assessDocumentQuality(testTenantId, testDocumentId);

      expect(assessment.overallScore).toBeDefined();
      expect(assessment.qualityIssues).toBeDefined();

      // Route to review queue if needed
      if (assessment.overallScore < 70) {
        const routed = await routeToReviewQueue(testTenantId, testDocumentId);
        expect(routed).toBe(true);
      }
    });

    it('should detect duplicate documents', async () => {
      // Create duplicate document
      const dupDocResult = await db.query<{ id: string }>(
        `INSERT INTO documents (tenant_id, file_name, file_type, file_size, status, confidence_score, extracted_data)
         VALUES ($1, 'test-invoice-dup.pdf', 'application/pdf', 1024, 'classified', 0.85, '{"total": 100, "date": "2024-01-15", "vendor": "Test Vendor"}'::jsonb)
         RETURNING id`,
        [testTenantId]
      );
      const dupDocId = dupDocResult.rows[0]?.id || '';

      const result = await detectDuplicates(testTenantId, dupDocId);

      expect(result.isDuplicate).toBe(true);
      expect(result.matches.length).toBeGreaterThan(0);
    });
  });

  describe('Filing Review Workflow', () => {
    it('should create review, get checklist, and approve filing', async () => {
      // Create attestation first
      await db.query(
        `INSERT INTO filing_attestations (id, filing_id, tenant_id, user_id, attested_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW())`,
        [testFilingId, testTenantId, testUserId]
      );

      // Create review
      const reviewId = await createFilingReview(testFilingId, testTenantId, testUserId);
      expect(reviewId).toBeDefined();

      // Get checklist
      const checklist = await getFilingReviewChecklist(testFilingId, testTenantId);
      expect(checklist.checks.length).toBeGreaterThan(0);

      // Approve if checklist passes
      if (checklist.canApprove) {
        await approveFilingReview(reviewId, testTenantId, testUserId, 'Approved for submission');
        
        const filingResult = await db.query<{ status: string }>(
          'SELECT status FROM filings WHERE id = $1',
          [testFilingId]
        );
        expect(filingResult.rows[0]?.status).toBe('pending_approval');
      }
    });
  });

  describe('Cross-Validation Workflow', () => {
    it('should cross-validate bank and ledger data', async () => {
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-01-31');

      // Create test bank account
      const accountResult = await db.query<{ id: string }>(
        `INSERT INTO bank_connections (tenant_id, provider, account_id, account_name, is_active)
         VALUES ($1, 'plaid', 'acc-123', 'Test Account', true)
         RETURNING id`,
        [testTenantId]
      );
      const accountId = accountResult.rows[0]?.id || '';

      // Create matching transactions
      await db.query(
        `INSERT INTO bank_transactions (id, tenant_id, account_id, transaction_id, date, amount, currency, description)
         VALUES (gen_random_uuid(), $1, $2, 'tx-1', $3, 100.00, 'GBP', 'Test Transaction')`,
        [testTenantId, accountId, periodStart]
      );

      await db.query(
        `INSERT INTO ledger_entries (id, tenant_id, account_code, transaction_date, amount, entry_type, description)
         VALUES (gen_random_uuid(), $1, '1000', $2, 100.00, 'debit', 'Test Transaction')`,
        [testTenantId, periodStart]
      );

      const report = await crossValidateData(testTenantId, periodStart, periodEnd);

      expect(report.bankBalance).toBe(100);
      expect(report.ledgerBalance).toBe(100);
      expect(report.matched).toBeGreaterThan(0);
    });
  });

  describe('Bank Connection Health Workflow', () => {
    it('should check connection health', async () => {
      // Create test bank connection
      const connResult = await db.query<{ id: string }>(
        `INSERT INTO bank_connections (tenant_id, provider, account_id, account_name, is_active, last_sync, token_expires_at)
         VALUES ($1, 'plaid', 'acc-123', 'Test Account', true, NOW() - INTERVAL '1 day', NOW() + INTERVAL '30 days')
         RETURNING id`,
        [testTenantId]
      );
      const connectionId = connResult.rows[0]?.id || '';

      const health = await checkConnectionHealth(testTenantId, connectionId);

      expect(health.length).toBe(1);
      expect(health[0].status).toBeDefined();
      expect(['healthy', 'warning', 'critical', 'expired']).toContain(health[0].status);
    });
  });
});
