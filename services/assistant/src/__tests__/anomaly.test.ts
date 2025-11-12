import { describe, it, expect } from '@jest/globals';

describe('Anomaly Detection', () => {
  it('should detect unusual amounts', () => {
    const mean = 1000;
    const stdDev = 200;
    const amount = 2000; // 5 standard deviations
    const isAnomaly = amount > mean + 3 * stdDev;
    expect(isAnomaly).toBe(true);
  });

  it('should detect duplicates', () => {
    const transactions = [
      { id: '1', amount: 100, description: 'Test' },
      { id: '2', amount: 100, description: 'Test' },
    ];
    const isDuplicate = transactions[0]?.amount === transactions[1]?.amount &&
                        transactions[0]?.description === transactions[1]?.description;
    expect(isDuplicate).toBe(true);
  });
});
