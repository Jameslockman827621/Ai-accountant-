import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { processPeriodEnd } from '../../services/ledger/src/services/periodEndProcessing';
import { checkUsageLimit } from '../../services/billing/src/services/usageEnforcement';
import { getUpcomingDeadlines } from '../../services/filing/src/services/deadlineManager';
import { createEmailVerificationToken } from '../../services/auth/src/services/securityTokens';

jest.mock('@ai-accountant/shared-utils', () => ({
  createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }),
}));

jest.mock('@ai-accountant/database', () => ({
  db: { query: jest.fn() },
}));

jest.mock('../../services/ledger/src/services/accrualsPrepayments', () => ({
  postAccrual: jest.fn().mockResolvedValue(undefined),
  reverseAccrual: jest.fn(),
  amortizePrepayment: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/ledger/src/services/depreciation', () => ({
  postDepreciation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/ledger/src/services/posting', () => ({
  postDoubleEntry: jest.fn().mockResolvedValue(undefined),
}));

describe('Critical path integrations', () => {
  const { db } = require('@ai-accountant/database');
  const queryMock = db.query as jest.Mock;

  beforeEach(() => {
    queryMock.mockReset();
  });

  it('keeps ledger, billing, filing, and auth flows aligned', async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql.includes('subscription_tier')) {
        return Promise.resolve({ rows: [{ subscription_tier: 'sme' }] });
      }
      if (sql.includes('usage_metrics')) {
        return Promise.resolve({ rows: [{ documents_processed: 0, ocr_requests: 0, llm_queries: 0, filings_submitted: 0, storage_used: 0 }] });
      }
      if (sql.includes('bank_connections')) {
        return Promise.resolve({ rows: [{ count: 0 }] });
      }
      if (sql.includes('FROM accruals')) {
        return Promise.resolve({ rows: [{ id: 'accrual-test' }] });
      }
      if (sql.includes('FROM prepayments')) {
        return Promise.resolve({ rows: [{ id: 'prep', period_start: new Date(), period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }] });
      }
      if (sql.includes('fixed_assets')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('bank_transactions')) {
        return Promise.resolve({ rows: [{ count: 0 }] });
      }
      if (sql.includes('ledger_entries') && sql.includes('entry_type = \'credit\'')) {
        return Promise.resolve({ rows: [{ total: 0 }] });
      }
      if (sql.includes('ledger_entries') && sql.includes('entry_type = \'debit\'')) {
        return Promise.resolve({ rows: [{ total: 0 }] });
      }
      if (sql.includes('FROM filings') && sql.includes('filing_type = \'vat\'')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('SELECT DISTINCT period_start')) {
        return Promise.resolve({ rows: [{ period_start: new Date(), period_end: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000) }] });
      }
      if (sql.includes('SELECT metadata FROM tenants')) {
        return Promise.resolve({ rows: [{ metadata: {} }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const usage = await checkUsageLimit('tenant' as any, 'documents');
    expect(usage.allowed).toBe(true);

    const checklist = await processPeriodEnd('tenant' as any, new Date('2024-12-31'), 'user' as any);
    expect(checklist.accrualsPosted).toBe(true);

    const deadlines = await getUpcomingDeadlines('tenant' as any, 60);
    expect(deadlines.length).toBeGreaterThan(0);

    const token = await createEmailVerificationToken('user');
    expect(token).toBeDefined();
  });
});
