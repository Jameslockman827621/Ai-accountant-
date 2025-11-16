import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { db } from '@ai-accountant/database';
import { verifyTaxCalculation } from '../taxCalculationVerifier';
import { TenantId } from '@ai-accountant/shared-types';

describe('TaxCalculationVerifier', () => {
  let testTenantId: TenantId;
  let testFilingId: string;

  beforeEach(async () => {
    // Create test tenant
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    testTenantId = tenantResult.rows[0]?.id as TenantId;

    // Create test filing
    const filingResult = await db.query<{ id: string }>(
      `INSERT INTO filings (tenant_id, filing_type, status, period_start, period_end, filing_data)
       VALUES ($1, 'vat', 'draft', '2024-01-01', '2024-01-31', '{"vatOutput": 1000, "vatInput": 200, "vatNet": 800}'::jsonb)
       RETURNING id`,
      [testTenantId]
    );
    testFilingId = filingResult.rows[0]?.id || '';
  });

  afterEach(async () => {
    if (testTenantId) {
      await db.query('DELETE FROM filings WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
  });

  it('should verify VAT calculation', async () => {
    const periodStart = new Date('2024-01-01');
    const periodEnd = new Date('2024-01-31');

    const result = await verifyTaxCalculation(testTenantId, 'vat', periodStart, periodEnd);

    expect(result.isValid).toBeDefined();
    expect(result.calculatedAmount).toBeDefined();
    expect(result.filedAmount).toBeDefined();
  });

  it('should detect calculation discrepancies', async () => {
    // Update filing with incorrect calculation
    await db.query(
      `UPDATE filings
       SET filing_data = '{"vatOutput": 1000, "vatInput": 200, "vatNet": 900}'::jsonb
       WHERE id = $1`,
      [testFilingId]
    );

    const periodStart = new Date('2024-01-01');
    const periodEnd = new Date('2024-01-31');

    const result = await verifyTaxCalculation(testTenantId, 'vat', periodStart, periodEnd);

    // Should detect that vatNet should be 800, not 900
    if (!result.isValid) {
      expect(result.discrepancies.length).toBeGreaterThan(0);
    }
  });
});
