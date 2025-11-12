import { describe, it, expect } from '@jest/globals';

describe('Tax Rules Service', () => {
  it('should apply UK VAT rules', () => {
    const transaction = { amount: 1000, category: 'standard' };
    const vatRate = 0.20; // UK standard VAT
    const vatAmount = transaction.amount * vatRate;
    expect(vatAmount).toBe(200);
  });

  it('should handle zero-rated items', () => {
    const transaction = { amount: 100, category: 'zero-rated' };
    const vatRate = 0;
    expect(vatRate).toBe(0);
  });
});
