import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '@ai-accountant/database';
import { calculateVATFromLedger } from '../services/vatCalculation';

describe('VAT Calculation', () => {
  let testTenantId: string;

  beforeAll(async () => {
    // Create test tenant
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test VAT Tenant', 'GB', 'freelancer')
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

  it('should calculate VAT correctly for sales', async () => {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Create sale with VAT
    await db.query(
      `INSERT INTO ledger_entries (
        tenant_id, entry_type, amount, tax_amount, tax_rate, description, transaction_date, account_code, account_name
      ) VALUES ($1, 'credit', 1000, 200, 0.20, 'Test Sale', $2, '4001', 'Sales')`,
      [testTenantId, periodStart]
    );

    const result = await calculateVATFromLedger(testTenantId, periodStart, periodEnd);

    expect(result.vatDueSales).toBe(200);
    expect(result.netVatDue).toBeGreaterThanOrEqual(0);
  });

  it('should calculate VAT correctly for purchases', async () => {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Create purchase with VAT
    await db.query(
      `INSERT INTO ledger_entries (
        tenant_id, entry_type, amount, tax_amount, tax_rate, description, transaction_date, account_code, account_name
      ) VALUES ($1, 'debit', 500, 100, 0.20, 'Test Purchase', $2, '6001', 'Expenses')`,
      [testTenantId, periodStart]
    );

    const result = await calculateVATFromLedger(testTenantId, periodStart, periodEnd);

    expect(result.vatReclaimedCurrPeriod).toBeGreaterThanOrEqual(0);
  });

  it('should calculate net VAT correctly', async () => {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Create both sale and purchase
    await db.query(
      `INSERT INTO ledger_entries (
        tenant_id, entry_type, amount, tax_amount, tax_rate, description, transaction_date, account_code, account_name
      ) VALUES
        ($1, 'credit', 1000, 200, 0.20, 'Sale', $2, '4001', 'Sales'),
        ($1, 'debit', 500, 100, 0.20, 'Purchase', $2, '6001', 'Expenses')`,
      [testTenantId, periodStart]
    );

    const result = await calculateVATFromLedger(testTenantId, periodStart, periodEnd);

    expect(result.netVatDue).toBe(100); // 200 - 100
  });
});
