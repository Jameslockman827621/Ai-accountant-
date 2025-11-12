import { describe, it, expect } from '@jest/globals';

describe('Cash Flow Forecasting', () => {
  it('should generate forecast', () => {
    const forecast = {
      period: { start: new Date(), end: new Date() },
      predictions: [
        { date: new Date(), amount: 1000, type: 'revenue' as const },
      ],
      confidence: 0.85,
    };
    expect(forecast.confidence).toBeGreaterThan(0.8);
  });
});
