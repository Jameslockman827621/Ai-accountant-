import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { db } from '@ai-accountant/database';
import { crossValidateData } from '../crossValidationEngine';
import { TenantId } from '@ai-accountant/shared-types';

describe('CrossValidationEngine', () => {
  let testTenantId: TenantId;
  let testAccountId: string;

  beforeEach(async () => {
    // Create test tenant
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Test Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    testTenantId = tenantResult.rows[0]?.id as TenantId;

    // Create test bank account
    const accountResult = await db.query<{ id: string }>(
      `INSERT INTO bank_connections (tenant_id, provider, account_id, account_name, is_active)
       VALUES ($1, 'plaid', 'acc-123', 'Test Account', true)
       RETURNING id`,
      [testTenantId]
    );
    testAccountId = accountResult.rows[0]?.id || '';
  });

  afterEach(async () => {
    if (testTenantId) {
      await db.query('DELETE FROM bank_transactions WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM ledger_entries WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM bank_connections WHERE tenant_id = $1', [testTenantId]);
      await db.query('DELETE FROM tenants WHERE id = $1', [testTenantId]);
    }
  });

  it('should cross-validate bank and ledger data', async () => {
    const periodStart = new Date('2024-01-01');
    const periodEnd = new Date('2024-01-31');

    // Create matching bank transaction and ledger entry
    await db.query(
      `INSERT INTO bank_transactions (id, tenant_id, account_id, transaction_id, date, amount, currency, description)
       VALUES (gen_random_uuid(), $1, $2, 'tx-1', $3, 100.00, 'GBP', 'Test Transaction')`,
      [testTenantId, testAccountId, periodStart]
    );

    await db.query(
      `INSERT INTO ledger_entries (id, tenant_id, account_code, transaction_date, amount, entry_type, description)
       VALUES (gen_random_uuid(), $1, '1000', $2, 100.00, 'debit', 'Test Transaction')`,
      [testTenantId, periodStart]
    );

    const report = await crossValidateData(testTenantId, periodStart, periodEnd);

    expect(report.bankBalance).toBe(100);
    expect(report.ledgerBalance).toBe(100);
    expect(report.difference).toBe(0);
    expect(report.matched).toBeGreaterThan(0);
  });

  it('should detect unmatched transactions', async () => {
    const periodStart = new Date('2024-01-01');
    const periodEnd = new Date('2024-01-31');

    // Create unmatched bank transaction
    await db.query(
      `INSERT INTO bank_transactions (id, tenant_id, account_id, transaction_id, date, amount, currency, description)
       VALUES (gen_random_uuid(), $1, $2, 'tx-1', $3, 100.00, 'GBP', 'Unmatched Transaction')`,
      [testTenantId, testAccountId, periodStart]
    );

    const report = await crossValidateData(testTenantId, periodStart, periodEnd);

    expect(report.unmatched).toBeGreaterThan(0);
  });
});
