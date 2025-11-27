import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import gocardlessFixture from '../__fixtures__/gocardless-accounts.json';
import adpFixture from '../__fixtures__/adp-payruns.json';
import vatLedgerFixture from '../__fixtures__/vat-ledger-entries.json';
import { GoCardlessService } from '../../bank-feed/src/services/gocardless';
import { createADPService } from '../../payroll/src/services/adp';
import { calculateVATFromLedger } from '../../filing/src/services/vatCalculation';
import { TenantId } from '@ai-accountant/shared-types';

jest.mock('@ai-accountant/shared-utils', () => ({
  createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }),
}));

jest.mock('@ai-accountant/database', () => ({
  db: { query: jest.fn() },
}));

jest.mock('../../bank-feed/src/services/connectionStore', () => ({
  persistConnectionTokens: jest.fn().mockResolvedValue('connection-123'),
  getConnectionSecrets: jest.fn(),
  getConnectionByProviderAccount: jest.fn(),
  markConnectionRefreshed: jest.fn(),
}));

jest.mock('../../bank-feed/src/services/connectionHealth', () => ({
  recordSyncError: jest.fn(),
  recordSyncSuccess: jest.fn(),
}));

describe('External connector contracts', () => {
  const { db } = require('@ai-accountant/database');
  const queryMock = db.query as jest.Mock;

  beforeEach(() => {
    queryMock.mockReset();
    global.fetch = jest.fn();
  });

  it('maps GoCardless accounts into persisted connection structure', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => gocardlessFixture });

    const service = new GoCardlessService();
    const connectionId = await service.createConnection('tenant-1' as TenantId, 'token', 'sandbox');

    expect(connectionId).toBe('connection-123');
    expect(global.fetch).toHaveBeenCalledWith('https://api-sandbox.gocardless.com/bank_accounts', expect.any(Object));
  });

  it('adapts ADP payroll runs to internal format', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => adpFixture });

    const service = createADPService({
      clientId: 'id',
      clientSecret: 'secret',
      baseUrl: 'https://example.adp',
      environment: 'sandbox',
    });

    const runs = await service.getPayrollRuns('worker-1');

    expect(runs[0]).toMatchObject({
      payPeriodStartDate: '2024-01-01',
      totalGrossPay: 15000,
      employeeCount: 5,
    });
  });

  it('calculates VAT obligations from ledger fixture', async () => {
    queryMock.mockResolvedValueOnce({ rows: vatLedgerFixture.entries });

    const result = await calculateVATFromLedger('tenant-3' as TenantId, new Date('2024-01-01'), new Date('2024-03-31'));

    expect(result.periodKey).toBe('202403');
    expect(result.totalVatDue).toBeGreaterThan(0);
    expect(result.breakdown.sales[0].vat).toBe(20);
  });
});
