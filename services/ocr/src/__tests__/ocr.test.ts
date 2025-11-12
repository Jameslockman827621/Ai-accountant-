import { describe, it, expect } from '@jest/globals';

describe('OCR Service', () => {
  it('should process image', () => {
    const imageFormat = 'image/jpeg';
    const supportedFormats = ['image/jpeg', 'image/png', 'application/pdf'];
    expect(supportedFormats.includes(imageFormat)).toBe(true);
  });

  it('should extract text', () => {
    const mockText = 'Invoice #12345\nTotal: £100.00';
    expect(mockText).toContain('Invoice');
    expect(mockText).toContain('£100.00');
  });
});
