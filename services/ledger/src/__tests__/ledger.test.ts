import request from 'supertest';
import app from '../index';
import { db } from '@ai-accountant/database';
import bcrypt from 'bcrypt';
import { LedgerEntryType } from '@ai-accountant/shared-types';

describe('Ledger Service', () => {
  let testTenantId: string = '';
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let testUserId: string = '';
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let authToken: string = '';

  beforeAll(async () => {
    const tenantResult = await db.query(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    testTenantId = (tenantResult.rows[0] as { id: string })?.id || '';

    const passwordHash = await bcrypt.hash('testpass123', 10);
    const userResult = await db.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, 'test@example.com', 'Test User', $2, 'client')
       RETURNING id`,
      [testTenantId, passwordHash]
    );
    testUserId = (userResult.rows[0] as { id: string })?.id || '';

    // Create chart of accounts
    await db.query(
      `INSERT INTO chart_of_accounts (tenant_id, accounts)
       VALUES ($1, $2)`,
      [
        testTenantId,
        JSON.stringify([
          { code: '1000', name: 'Cash', type: 'asset', isActive: true },
          { code: '5000', name: 'Sales', type: 'revenue', isActive: true },
        ]),
      ]
    );

    // Get auth token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'testpass123',
      });
    authToken = loginResponse.body.token;
  });

  afterAll(async () => {
    if (testTenantId) {
      await db.query('DELETE FROM ledger_entries WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM chart_of_accounts WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM users WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
    await db.close();
  });

  describe('POST /api/ledger/entries', () => {
    it('should create a ledger entry', async () => {
      const response = await request(app)
        .post('/api/ledger/entries')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          entryType: LedgerEntryType.DEBIT,
          accountCode: '1000',
          accountName: 'Cash',
          amount: 1000,
          currency: 'GBP',
          description: 'Test entry',
          transactionDate: new Date().toISOString(),
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('entry');
      expect(response.body.entry.amount).toBe(1000);
    });

    it('should reject entry with missing fields', async () => {
      const response = await request(app)
        .post('/api/ledger/entries')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          entryType: LedgerEntryType.DEBIT,
          // Missing required fields
        });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /api/ledger/entries', () => {
    it('should get ledger entries', async () => {
      const response = await request(app)
        .get('/api/ledger/entries')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('entries');
      expect(response.body).toHaveProperty('total');
    });
  });

  describe('GET /api/ledger/accounts/:accountCode/balance', () => {
    it('should get account balance', async () => {
      const response = await request(app)
        .get('/api/ledger/accounts/1000/balance')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('balance');
      expect(response.body).toHaveProperty('debitTotal');
      expect(response.body).toHaveProperty('creditTotal');
    });
  });
});
