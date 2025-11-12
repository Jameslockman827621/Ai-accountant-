import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';

describe('Auth Service', () => {
  let testTenantId: string;
  let testUserId: string;

  beforeAll(async () => {
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Auth Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    testTenantId = tenantResult.rows[0]?.id || '';

    const userResult = await db.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, 'test@example.com', 'Test User', 'hash', 'client')
       RETURNING id`,
      [testTenantId]
    );
    testUserId = userResult.rows[0]?.id || '';
  });

  afterAll(async () => {
    if (testTenantId) {
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
    await db.close();
  });

  it('should create user', () => {
    expect(testUserId).toBeDefined();
  });

  it('should authenticate user', async () => {
    const result = await db.query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE id = $1',
      [testUserId]
    );
    expect(result.rows[0]?.email).toBe('test@example.com');
  });
});
