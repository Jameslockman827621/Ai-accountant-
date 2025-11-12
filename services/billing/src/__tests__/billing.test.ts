import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';

describe('Billing Service', () => {
  let testTenantId: string;

  beforeAll(async () => {
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Billing Tenant', 'GB', 'freelancer')
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

  it('should create subscription', async () => {
    const result = await db.query(
      `INSERT INTO subscriptions (tenant_id, plan, status, current_period_start, current_period_end)
       VALUES ($1, 'freelancer', 'active', NOW(), NOW() + INTERVAL '1 month')
       RETURNING id`,
      [testTenantId]
    );
    expect(result.rows[0]?.id).toBeDefined();
  });

  it('should track usage', async () => {
    const result = await db.query(
      `INSERT INTO usage_metrics (tenant_id, metric_type, value, period)
       VALUES ($1, 'documents_processed', 100, DATE_TRUNC('month', NOW()))
       RETURNING id`,
      [testTenantId]
    );
    expect(result.rows[0]?.id).toBeDefined();
  });
});
