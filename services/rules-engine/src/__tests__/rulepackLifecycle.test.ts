import { jest } from '@jest/globals';
import { calculateTaxForJurisdiction, runRegressionSuite } from '../services/multiCountryTax';
import { getBuiltInUSRulepacks } from '../../../multi-jurisdiction/src/services/usTaxSystem';

jest.mock('@ai-accountant/database', () => ({
  db: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    transaction: jest.fn(async (fn: (client: { query: jest.Mock }) => Promise<unknown>) =>
      fn({
        query: jest.fn().mockResolvedValue({ rows: [{ id: 'mock-rulepack' }] }),
      })
    ),
  },
}));

describe('Rulepack lifecycle', () => {
  it('calculates US federal income tax for single filer', async () => {
    const result = await calculateTaxForJurisdiction('tenant-test', 'US', {
      amount: 95000,
      type: 'income',
      filingStatus: 'single',
    });

    expect(result.taxAmount).toBeCloseTo(12741, 2);
    expect(result.jurisdictionCode).toBe('US');
  });

  it('runs regression suite for built-in US rulepack', async () => {
    const pack = getBuiltInUSRulepacks()[0];
    const regression = await runRegressionSuite(pack);

    expect(regression.summary.failed).toBe(0);
    expect(regression.summary.passed).toBe(regression.summary.total);
  });
});
