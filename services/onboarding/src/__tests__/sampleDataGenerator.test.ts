import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { db } from '@ai-accountant/database';
import { generateSampleData } from '../services/sampleDataGenerator';
import { TenantId, UserId } from '@ai-accountant/shared-types';

describe('SampleDataGenerator', () => {
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
      await db.query('DELETE FROM bank_transactions WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM ledger_entries WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM documents WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM users WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
  });

  it('should generate sample data', async () => {
    const result = await generateSampleData(testTenantId, testUserId);

    expect(result.documentsCreated).toBeGreaterThan(0);
    expect(result.ledgerEntriesCreated).toBeGreaterThan(0);
    expect(result.bankTransactionsCreated).toBeGreaterThan(0);
  });

  it('should create realistic sample documents', async () => {
    await generateSampleData(testTenantId, testUserId);

    const docResult = await db.query<{ count: number }>(
      'SELECT COUNT(*) as count FROM documents WHERE tenant_id = $1',
      [testTenantId]
    );

    expect(parseInt(String(docResult.rows[0]?.count || 0), 10)).toBeGreaterThan(0);
  });
});
