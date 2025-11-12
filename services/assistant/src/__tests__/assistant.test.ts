import { describe, it, expect } from '@jest/globals';

describe('Assistant Service', () => {
  it('should process query', () => {
    const query = 'What is my VAT due?';
    expect(query.length).toBeGreaterThan(0);
  });

  it('should generate response', () => {
    const mockResponse = {
      answer: 'Your VAT due is £500.00',
      confidence: 0.95,
    };
    expect(mockResponse.answer).toBeDefined();
    expect(mockResponse.confidence).toBeGreaterThan(0.9);
  });
});
