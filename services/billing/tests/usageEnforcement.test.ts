import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { checkUsageLimit } from '../src/services/usageEnforcement';
import { TenantId } from '@ai-accountant/shared-types';

jest.mock('@ai-accountant/shared-utils', () => ({
  createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }),
}));

jest.mock('@ai-accountant/database', () => ({
  db: { query: jest.fn() },
}));

describe('usageEnforcement', () => {
  const tenantId = 'tenant-billing' as TenantId;
  const { db } = require('@ai-accountant/database');
  const queryMock = db.query as jest.Mock;

  beforeEach(() => {
    queryMock.mockReset();
  });

  it('allows usage when below tier limits', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ subscription_tier: 'sme' }] })
      .mockResolvedValueOnce({ rows: [{ documents_processed: 10, ocr_requests: 5, llm_queries: 7, filings_submitted: 1, storage_used: 1 }] })
      .mockResolvedValueOnce({ rows: [{ count: 1 }] });

    const result = await checkUsageLimit(tenantId, 'documents');

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('blocks usage when bank connections exceed limits', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ subscription_tier: 'freelancer' }] })
      .mockResolvedValueOnce({ rows: [{ documents_processed: 0, ocr_requests: 0, llm_queries: 0, filings_submitted: 0, storage_used: 0 }] })
      .mockResolvedValueOnce({ rows: [{ count: 5 }] });

    const result = await checkUsageLimit(tenantId, 'bank_connections');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Limit reached');
  });
});
