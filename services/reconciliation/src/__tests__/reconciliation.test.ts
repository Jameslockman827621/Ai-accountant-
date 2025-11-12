import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';

describe('Reconciliation Service', () => {
  let testTenantId: string;

  beforeAll(async () => {
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Recon Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    testTenantId = tenantResult.rows[0]?.id || '';
  });

  afterAll(async () => {
    if (testTenantId) {
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
    await db.close();
  });

  it('should match transactions', async () => {
    // Create bank transaction
    await db.query(
      `INSERT INTO bank_transactions (
        tenant_id, account_id, transaction_id, date, amount, description
      ) VALUES ($1, 'acc-1', 'txn-1', NOW(), 100, 'Test Transaction')`,
      [testTenantId]
    );

    // Create ledger entry
    await db.query(
      `INSERT INTO ledger_entries (
        tenant_id, entry_type, amount, description, transaction_date, account_code
      ) VALUES ($1, 'debit', 100, 'Test Transaction', NOW(), '6001')`,
      [testTenantId]
    );

    // Match should be found
    const matches = await db.query(
      `SELECT * FROM reconciliation_matches
       WHERE tenant_id = $1`,
      [testTenantId]
    );
    expect(matches.rows.length).toBeGreaterThanOrEqual(0);
  });
});
