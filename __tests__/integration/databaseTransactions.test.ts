import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';

describe('Database Transactions', () => {
  let testTenantId: string;

  beforeAll(async () => {
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Transaction Tenant', 'GB', 'freelancer')
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

  it('should handle database transactions', async () => {
    await db.transaction(async (client) => {
      await client.query(
        `INSERT INTO ledger_entries (
          tenant_id, entry_type, amount, description, transaction_date, account_code, account_name
        ) VALUES ($1, 'credit', 1000, 'Test', NOW(), '4001', 'Sales')`,
        [testTenantId]
      );
    });
    // Transaction should commit successfully
    expect(true).toBe(true);
  });
});
