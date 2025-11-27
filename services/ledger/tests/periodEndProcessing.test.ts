import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { processPeriodEnd } from '../src/services/periodEndProcessing';
import { TenantId, UserId } from '@ai-accountant/shared-types';

jest.mock('@ai-accountant/shared-utils', () => ({
  createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }),
}));

jest.mock('@ai-accountant/database', () => ({
  db: { query: jest.fn() },
}));

jest.mock('../src/services/accrualsPrepayments', () => ({
  postAccrual: jest.fn().mockResolvedValue(undefined),
  reverseAccrual: jest.fn(),
  amortizePrepayment: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/depreciation', () => ({
  postDepreciation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/posting', () => ({
  postDoubleEntry: jest.fn().mockResolvedValue(undefined),
}));

describe('processPeriodEnd', () => {
  const tenantId = 'tenant-123' as TenantId;
  const userId = 'user-123' as UserId;
  const periodEnd = new Date('2024-12-31');
  const { db } = require('@ai-accountant/database');
  const queryMock = db.query as jest.Mock;
  const { postAccrual, amortizePrepayment } = require('../src/services/accrualsPrepayments');
  const { postDepreciation } = require('../src/services/depreciation');
  const { postDoubleEntry } = require('../src/services/posting');

  beforeEach(() => {
    queryMock.mockReset();
    postAccrual.mockClear();
    amortizePrepayment.mockClear();
    postDepreciation.mockClear();
    postDoubleEntry.mockClear();
  });

  it('executes period end workflow and returns checklist flags', async () => {
    queryMock
      // pending accruals
      .mockResolvedValueOnce({ rows: [{ id: 'accrual-1' }] })
      // pending prepayments
      .mockResolvedValueOnce({ rows: [{ id: 'prep-1', period_start: new Date('2024-10-01'), period_end: new Date('2025-01-01') }] })
      // fixed assets
      .mockResolvedValueOnce({ rows: [{
        id: 'asset-1',
        description: 'Laptop',
        account_code: '1800',
        purchase_date: new Date('2022-01-01'),
        purchase_cost: 1200,
        residual_value: 100,
        useful_life: 36,
        depreciation_method: 'straight_line',
        depreciation_rate: 0,
      }] })
      // unreconciled count
      .mockResolvedValueOnce({ rows: [{ count: 0 }] })
      // revenue total
      .mockResolvedValueOnce({ rows: [{ total: 5000 }] })
      // expense total
      .mockResolvedValueOnce({ rows: [{ total: 1200 }] });

    const checklist = await processPeriodEnd(tenantId, periodEnd, userId);

    expect(postAccrual).toHaveBeenCalledWith('accrual-1', tenantId);
    expect(amortizePrepayment).toHaveBeenCalledWith('prep-1', tenantId, expect.any(Number));
    expect(postDepreciation).toHaveBeenCalledWith(tenantId, expect.any(Object), periodEnd, userId);
    expect(postDoubleEntry).toHaveBeenCalled();

    expect(checklist).toEqual({
      accrualsPosted: true,
      prepaymentsAmortized: true,
      depreciationPosted: true,
      bankReconciled: true,
      journalsReviewed: false,
      reportsGenerated: false,
      taxCalculated: true,
      filingPrepared: false,
    });
  });
});
