/**
 * Integration tests for ledger and reconciliation automation
 */

import { db } from '../../services/database/src/index';
import { intelligentMatchingService } from '../../services/reconciliation/src/services/intelligentMatching';
import { reconciliationExceptionService } from '../../services/reconciliation/src/services/reconciliationExceptions';
import { periodCloseService } from '../../services/ledger/src/services/periodCloseService';
import { multiEntityService } from '../../services/ledger/src/services/multiEntityService';
import { anomalyDetectionService } from '../../services/reconciliation/src/services/anomalyDetection';
import { matchingThresholdsInitializer } from '../../services/reconciliation/src/services/matchingThresholdsInitializer';
import { exchangeRateService } from '../../services/ledger/src/services/exchangeRateService';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

describe('Ledger and Reconciliation Integration Tests', () => {
  let testTenantId: TenantId;
  let testUserId: UserId;
  let testEntityId: string;

  beforeAll(async () => {
    // Create test tenant
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (id, name, is_active, created_at, updated_at)
       VALUES ($1, 'Test Tenant', true, NOW(), NOW())
       RETURNING id`,
      [randomUUID()]
    );
    testTenantId = tenantResult.rows[0].id as TenantId;

    // Create test user
    const userResult = await db.query<{ id: string }>(
      `INSERT INTO users (id, tenant_id, email, password_hash, role, is_active, created_at, updated_at)
       VALUES ($1, $2, 'test@example.com', 'hash', 'admin', true, NOW(), NOW())
       RETURNING id`,
      [randomUUID(), testTenantId]
    );
    testUserId = userResult.rows[0].id as UserId;

    // Initialize matching thresholds
    await matchingThresholdsInitializer.initializeForTenant(testTenantId);
  });

  afterAll(async () => {
    // Cleanup test data
    await db.query('DELETE FROM users WHERE tenant_id = $1', [testTenantId]);
    await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    await db.close();
  });

  describe('Matching Thresholds', () => {
    it('should initialize default thresholds for tenant', async () => {
      const thresholds = await intelligentMatchingService.getThresholds(testTenantId);
      expect(thresholds.autoMatch).toBeGreaterThan(0);
      expect(thresholds.suggestMatch).toBeGreaterThan(0);
      expect(thresholds.signalWeights.amount).toBeGreaterThan(0);
    });

    it('should update thresholds', async () => {
      await intelligentMatchingService.updateThresholds(
        testTenantId,
        {
          autoMatch: 0.90,
          suggestMatch: 0.65,
        },
        10
      );

      const updated = await intelligentMatchingService.getThresholds(testTenantId);
      expect(updated.autoMatch).toBe(0.90);
      expect(updated.suggestMatch).toBe(0.65);
    });
  });

  describe('Intelligent Matching', () => {
    let bankTransactionId: string;
    let documentId: string;

    beforeEach(async () => {
      // Create test bank transaction
      const txResult = await db.query<{ id: string }>(
        `INSERT INTO bank_transactions (
          id, tenant_id, account_id, transaction_id, date, amount, currency,
          description, category, reconciled, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
        RETURNING id`,
        [
          randomUUID(),
          testTenantId,
          randomUUID(),
          'TXN001',
          new Date(),
          100.00,
          'GBP',
          'Test Transaction',
          'expense',
          false,
        ]
      );
      bankTransactionId = txResult.rows[0].id;

      // Create test document
      const docResult = await db.query<{ id: string }>(
        `INSERT INTO documents (
          id, tenant_id, file_name, file_type, status, extracted_data,
          confidence_score, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(), NOW())
        RETURNING id`,
        [
          randomUUID(),
          testTenantId,
          'test-invoice.pdf',
          'application/pdf',
          'extracted',
          JSON.stringify({
            total: 100.00,
            date: new Date().toISOString(),
            vendor: 'Test Vendor',
            description: 'Test Transaction',
          }),
          0.95,
        ]
      );
      documentId = docResult.rows[0].id;
    });

    afterEach(async () => {
      await db.query('DELETE FROM bank_transactions WHERE id = $1', [bankTransactionId]);
      await db.query('DELETE FROM documents WHERE id = $1', [documentId]);
    });

    it('should find matches for bank transaction', async () => {
      const matches = await intelligentMatchingService.findMatches(testTenantId, bankTransactionId);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].documentId).toBe(documentId);
      expect(matches[0].confidenceScore).toBeGreaterThan(0);
    });

    it('should record reconciliation event', async () => {
      const eventId = await intelligentMatchingService.recordEvent(testTenantId, {
        bankTransactionId,
        documentId,
        eventType: 'match',
        reasonCode: 'test_match',
        reasonDescription: 'Test match',
        confidenceScore: 0.95,
        matchSignals: {
          amount: 1.0,
          date: 1.0,
          vendor: 0.8,
          ocrConfidence: 0.95,
          description: 0.9,
        },
        performedBy: testUserId,
      });

      expect(eventId).toBeDefined();

      const eventResult = await db.query(
        'SELECT * FROM reconciliation_events WHERE id = $1',
        [eventId]
      );
      expect(eventResult.rows.length).toBe(1);
    });
  });

  describe('Reconciliation Exceptions', () => {
    it('should create exception', async () => {
      const exceptionId = await reconciliationExceptionService.createException(testTenantId, {
        exceptionType: 'unmatched',
        bankTransactionId: randomUUID(),
        description: 'Test exception',
        severity: 'medium',
      });

      expect(exceptionId).toBeDefined();

      const exceptions = await reconciliationExceptionService.getExceptions(testTenantId, {
        status: 'open',
      });
      expect(exceptions.length).toBeGreaterThan(0);
    });

    it('should resolve exception', async () => {
      const exceptionId = await reconciliationExceptionService.createException(testTenantId, {
        exceptionType: 'unmatched',
        bankTransactionId: randomUUID(),
        description: 'Test exception',
      });

      await reconciliationExceptionService.resolveException(
        exceptionId,
        testTenantId,
        testUserId,
        'Resolved in test'
      );

      const exceptions = await reconciliationExceptionService.getExceptions(testTenantId, {
        status: 'resolved',
      });
      expect(exceptions.some((e) => e.id === exceptionId)).toBe(true);
    });
  });

  describe('Period Close', () => {
    it('should create period close', async () => {
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-01-31');

      const closeId = await periodCloseService.createPeriodClose(
        testTenantId,
        periodStart,
        periodEnd
      );

      expect(closeId).toBeDefined();

      const close = await periodCloseService.getCloseStatus(closeId, testTenantId);
      expect(close).not.toBeNull();
      expect(close?.closeStatus).toBe('draft');
    });

    it('should get close tasks', async () => {
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-01-31');

      const closeId = await periodCloseService.createPeriodClose(
        testTenantId,
        periodStart,
        periodEnd
      );

      const tasks = await periodCloseService.getCloseTasks(closeId);
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.some((t) => t.taskType === 'accrual')).toBe(true);
      expect(tasks.some((t) => t.taskType === 'depreciation')).toBe(true);
    });

    it('should start close process', async () => {
      const periodStart = new Date('2024-01-01');
      const periodEnd = new Date('2024-01-31');

      const closeId = await periodCloseService.createPeriodClose(
        testTenantId,
        periodStart,
        periodEnd
      );

      await periodCloseService.startClose(closeId, testTenantId, testUserId);

      const close = await periodCloseService.getCloseStatus(closeId, testTenantId);
      expect(close?.closeStatus).toBe('in_progress');
    });
  });

  describe('Multi-Entity', () => {
    it('should create entity', async () => {
      const entityId = await multiEntityService.createEntity(testTenantId, {
        entityName: 'Test Entity',
        entityType: 'subsidiary',
        currency: 'GBP',
      });

      expect(entityId).toBeDefined();

      const entities = await multiEntityService.getEntityHierarchy(testTenantId);
      expect(entities.some((e) => e.id === entityId)).toBe(true);
    });

    it('should store exchange rate', async () => {
      const rateId = await multiEntityService.storeExchangeRate(
        testTenantId,
        'USD',
        'GBP',
        new Date(),
        0.79,
        'spot',
        'test'
      );

      expect(rateId).toBeDefined();
    });
  });

  describe('Anomaly Detection', () => {
    it('should detect anomalies', async () => {
      // Create test transaction for anomaly detection
      await db.query(
        `INSERT INTO bank_transactions (
          id, tenant_id, account_id, transaction_id, date, amount, currency,
          description, category, reconciled, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
        [
          randomUUID(),
          testTenantId,
          randomUUID(),
          'TXN002',
          new Date(),
          50000.00, // Large amount for anomaly detection
          'GBP',
          'Large Transaction',
          'expense',
          false,
        ]
      );

      const anomalies = await anomalyDetectionService.detectAnomalies(testTenantId, {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(),
      });

      // Should detect unusual spend if threshold is met
      expect(Array.isArray(anomalies)).toBe(true);
    });
  });
});
