import { describe, it, expect } from '@jest/globals';

describe('Corporation Tax Calculation', () => {
  it('should calculate corporation tax for small profits', () => {
    const profit = 30000;
    const rate = 0.19; // Small profits rate
    const tax = profit * rate;
    expect(tax).toBe(5700);
  });

  it('should calculate corporation tax for large profits', () => {
    const profit = 300000;
    const rate = 0.25; // Main rate
    const tax = profit * rate;
    expect(tax).toBe(75000);
  });
});
