import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';
import { createLedgerEntry, getLedgerEntries } from '../services/ledger';

describe('Ledger Service', () => {
  let testTenantId: string;

  beforeAll(async () => {
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Ledger Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    testTenantId = tenantResult.rows[0]?.id || '';

    // Create chart of accounts
    await db.query(
      `INSERT INTO chart_of_accounts (tenant_id, accounts)
       VALUES ($1, $2::jsonb)`,
      [
        testTenantId,
        JSON.stringify([
          { code: '4001', name: 'Sales' },
          { code: '6001', name: 'Expenses' },
        ]),
      ]
    );
  });

  afterAll(async () => {
    if (testTenantId) {
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
    await db.close();
  });

  it('should create a ledger entry', async () => {
    const entryId = await createLedgerEntry({
      tenantId: testTenantId,
      entryType: 'credit',
      amount: 1000,
      accountCode: '4001',
      accountName: 'Sales',
      description: 'Test Sale',
      transactionDate: new Date(),
    });

    expect(entryId).toBeDefined();
  });

  it('should retrieve ledger entries', async () => {
    await createLedgerEntry({
      tenantId: testTenantId,
      entryType: 'debit',
      amount: 500,
      accountCode: '6001',
      accountName: 'Expenses',
      description: 'Test Expense',
      transactionDate: new Date(),
    });

    const entries = await getLedgerEntries(testTenantId, {
      startDate: new Date('2020-01-01'),
      endDate: new Date('2030-12-31'),
    });

    expect(entries.length).toBeGreaterThan(0);
  });
});
