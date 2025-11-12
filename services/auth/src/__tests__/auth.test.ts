import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';
import { hashPassword, verifyPassword } from '@ai-accountant/shared-utils';
import { createUser, authenticateUser } from '../services/auth';

describe('Authentication Service', () => {
  let testTenantId: string;

  beforeAll(async () => {
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Auth Tenant', 'GB', 'freelancer')
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

  it('should create a user with hashed password', async () => {
    const password = 'TestPassword123!';
    const userId = await createUser({
      tenantId: testTenantId,
      email: 'test@example.com',
      name: 'Test User',
      password,
      role: 'client',
    });

    expect(userId).toBeDefined();

    const userResult = await db.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    const storedHash = userResult.rows[0]?.password_hash;
    expect(storedHash).toBeDefined();
    expect(storedHash).not.toBe(password);
  });

  it('should authenticate user with correct password', async () => {
    const email = 'auth@example.com';
    const password = 'AuthPassword123!';

    await createUser({
      tenantId: testTenantId,
      email,
      name: 'Auth User',
      password,
      role: 'client',
    });

    const result = await authenticateUser(email, password);
    expect(result).toBeDefined();
    expect(result.user.email).toBe(email);
  });

  it('should reject authentication with incorrect password', async () => {
    const email = 'wrong@example.com';
    const password = 'CorrectPassword123!';

    await createUser({
      tenantId: testTenantId,
      email,
      name: 'Wrong User',
      password,
      role: 'client',
    });

    await expect(authenticateUser(email, 'WrongPassword')).rejects.toThrow();
  });
});
