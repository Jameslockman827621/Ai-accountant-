import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';

describe('Filing Service', () => {
  let testTenantId: string;

  beforeAll(async () => {
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier, vat_number)
       VALUES ('Test Filing Tenant', 'GB', 'freelancer', 'GB123456789')
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

  it('should create VAT filing', async () => {
    const result = await db.query(
      `INSERT INTO filings (
        tenant_id, filing_type, status, period_start, period_end, filing_data
      ) VALUES ($1, 'vat', 'draft', NOW() - INTERVAL '3 months', NOW(), '{}'::jsonb)
      RETURNING id`,
      [testTenantId]
    );
    expect(result.rows[0]?.id).toBeDefined();
  });
});
