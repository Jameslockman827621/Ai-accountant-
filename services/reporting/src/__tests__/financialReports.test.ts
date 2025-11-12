import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';
import { generateProfitAndLoss } from '../services/financialReports';

describe('Financial Reports', () => {
  let testTenantId: string;

  beforeAll(async () => {
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Reports Tenant', 'GB', 'freelancer')
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

  it('should generate Profit & Loss report', async () => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), 0, 1);
    const endDate = new Date(now.getFullYear(), 11, 31);

    // Create revenue entry
    await db.query(
      `INSERT INTO ledger_entries (
        tenant_id, entry_type, amount, description, transaction_date, account_code, account_name
      ) VALUES ($1, 'credit', 10000, 'Revenue', $2, '4001', 'Sales')`,
      [testTenantId, startDate]
    );

    // Create expense entry
    await db.query(
      `INSERT INTO ledger_entries (
        tenant_id, entry_type, amount, description, transaction_date, account_code, account_name
      ) VALUES ($1, 'debit', 5000, 'Expense', $2, '6001', 'Cost of Sales')`,
      [testTenantId, startDate]
    );

    const result = await generateProfitAndLoss(testTenantId, startDate, endDate);

    expect(result.revenue.total).toBeGreaterThan(0);
    expect(result.expenses.total).toBeGreaterThan(0);
    expect(result.netProfit).toBeDefined();
  });
});
