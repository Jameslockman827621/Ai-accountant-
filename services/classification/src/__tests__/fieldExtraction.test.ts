import { describe, it, expect } from '@jest/globals';

describe('Field Extraction', () => {
  it('should extract vendor name', () => {
    const text = 'Invoice from: Acme Corporation Ltd';
    const vendor = text.match(/Invoice from:\s*(.+)/i)?.[1];
    expect(vendor).toBe('Acme Corporation Ltd');
  });

  it('should extract invoice number', () => {
    const text = 'Invoice Number: INV-2024-001';
    const invoiceNumber = text.match(/Invoice Number:\s*(\S+)/i)?.[1];
    expect(invoiceNumber).toBe('INV-2024-001');
  });

  it('should extract dates in various formats', () => {
    const formats = [
      '2024-01-15',
      '15/01/2024',
      'January 15, 2024',
    ];
    
    formats.forEach(format => {
      const date = new Date(format);
      expect(date.getTime()).toBeGreaterThan(0);
    });
  });
});
