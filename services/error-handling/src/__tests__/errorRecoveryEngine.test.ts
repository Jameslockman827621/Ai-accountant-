import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { db } from '@ai-accountant/database';
import { errorRecoveryEngine } from '../services/errorRecoveryEngine';
import { TenantId, UserId } from '@ai-accountant/shared-types';

describe('ErrorRecoveryEngine', () => {
  let testTenantId: TenantId;
  let testUserId: UserId;

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
  });

  afterEach(async () => {
    if (testTenantId) {
      await db.query('DELETE FROM error_retries WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM users WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
  });

  it('should schedule a retry', async () => {
    const retryId = await errorRecoveryEngine.scheduleRetry(
      testTenantId,
      testUserId,
      'document_processing',
      'doc-123',
      'Processing failed',
      { attempt: 1 }
    );

    expect(retryId).toBeDefined();

    const retries = await errorRecoveryEngine.getRetriesForOperation(
      testTenantId,
      'document_processing',
      'doc-123'
    );

    expect(retries.length).toBe(1);
    expect(retries[0].status).toBe('pending');
  });

  it('should get pending retries', async () => {
    await errorRecoveryEngine.scheduleRetry(
      testTenantId,
      testUserId,
      'document_processing',
      'doc-123',
      'Processing failed',
      { attempt: 1 }
    );

    const pending = await errorRecoveryEngine.getPendingRetries();

    expect(pending.length).toBeGreaterThan(0);
  });

  it('should mark retry as succeeded', async () => {
    const retryId = await errorRecoveryEngine.scheduleRetry(
      testTenantId,
      testUserId,
      'document_processing',
      'doc-123',
      'Processing failed',
      { attempt: 1 }
    );

    await errorRecoveryEngine.markSucceeded(retryId);

    const retries = await errorRecoveryEngine.getRetriesForOperation(
      testTenantId,
      'document_processing',
      'doc-123'
    );

    expect(retries[0].status).toBe('succeeded');
  });
});
