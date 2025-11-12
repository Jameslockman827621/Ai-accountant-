import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';

describe('Multi-Tenant Isolation', () => {
  let tenant1Id: string;
  let tenant2Id: string;

  beforeAll(async () => {
    const t1 = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Tenant 1', 'GB', 'freelancer')
       RETURNING id`
    );
    tenant1Id = t1.rows[0]?.id || '';

    const t2 = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Tenant 2', 'GB', 'freelancer')
       RETURNING id`
    );
    tenant2Id = t2.rows[0]?.id || '';
  });

  afterAll(async () => {
    if (tenant1Id) await db.query('DELETE FROM tenants WHERE id = $1', [tenant1Id]);
    if (tenant2Id) await db.query('DELETE FROM tenants WHERE id = $1', [tenant2Id]);
    await db.close();
  });

  it('should isolate data between tenants', async () => {
    // Create data for tenant 1
    await db.query(
      `INSERT INTO ledger_entries (
        tenant_id, entry_type, amount, description, transaction_date, account_code, account_name
      ) VALUES ($1, 'credit', 1000, 'Tenant 1 Sale', NOW(), '4001', 'Sales')`,
      [tenant1Id]
    );

    // Query tenant 1 data
    const tenant1Data = await db.query(
      'SELECT * FROM ledger_entries WHERE tenant_id = $1',
      [tenant1Id]
    );

    // Query tenant 2 data
    const tenant2Data = await db.query(
      'SELECT * FROM ledger_entries WHERE tenant_id = $1',
      [tenant2Id]
    );

    expect(tenant1Data.rows.length).toBeGreaterThan(0);
    expect(tenant2Data.rows.length).toBe(0); // Tenant 2 should have no data
  });
});
