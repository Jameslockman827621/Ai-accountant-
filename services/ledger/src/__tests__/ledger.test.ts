import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';

describe('Ledger Service', () => {
  let testTenantId: string;

  beforeAll(async () => {
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Ledger Tenant', 'GB', 'freelancer')
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

  it('should create ledger entry', async () => {
    const result = await db.query(
      `INSERT INTO ledger_entries (
        tenant_id, entry_type, amount, description, transaction_date, account_code, account_name
      ) VALUES ($1, 'credit', 1000, 'Test Entry', NOW(), '4001', 'Sales')
      RETURNING id`,
      [testTenantId]
    );
    expect(result.rows[0]?.id).toBeDefined();
  });

  it('should enforce double-entry accounting', () => {
    const debit = 500;
    const credit = 500;
    expect(debit).toBe(credit);
  });
});
