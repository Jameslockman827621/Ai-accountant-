import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';
import { calculateVATFromLedger } from '../../services/filing/src/services/vatCalculation';
import { generateProfitAndLoss } from '../../services/reporting/src/services/financialReports';

describe('Service Integration Tests', () => {
  let testTenantId: string;

  beforeAll(async () => {
    // Create test tenant
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    testTenantId = tenantResult.rows[0]?.id || '';

    // Create test user
    await db.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, 'test@example.com', 'Test User', 'hash', 'client')`,
      [testTenantId]
    );
  });

  afterAll(async () => {
    // Cleanup
    if (testTenantId) {
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
    await db.close();
  });

  describe('VAT Calculation', () => {
    it('should calculate VAT from ledger entries', async () => {
      // Create test ledger entries
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      await db.query(
        `INSERT INTO ledger_entries (
          tenant_id, entry_type, amount, tax_amount, tax_rate, description, transaction_date, account_code, account_name
        ) VALUES
          ($1, 'credit', 1000, 200, 0.20, 'Sale', $2, '4001', 'Sales'),
          ($1, 'debit', 500, 100, 0.20, 'Purchase', $2, '6001', 'Expenses')`,
        [testTenantId, periodStart]
      );

      const result = await calculateVATFromLedger(testTenantId, periodStart, periodEnd);

      expect(result.vatDueSales).toBeGreaterThan(0);
      expect(result.vatReclaimedCurrPeriod).toBeGreaterThan(0);
      expect(result.netVatDue).toBeDefined();
    });
  });

  describe('Financial Reports', () => {
    it('should generate Profit & Loss report', async () => {
      const now = new Date();
      const startDate = new Date(now.getFullYear(), 0, 1);
      const endDate = new Date(now.getFullYear(), 11, 31);

      const result = await generateProfitAndLoss(testTenantId, startDate, endDate);

      expect(result.revenue).toBeDefined();
      expect(result.expenses).toBeDefined();
      expect(result.netProfit).toBeDefined();
      expect(result.period.start).toEqual(startDate);
      expect(result.period.end).toEqual(endDate);
    });
  });
});
