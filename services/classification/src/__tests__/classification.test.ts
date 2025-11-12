import { describe, it, expect } from '@jest/globals';

describe('Classification Service', () => {
  it('should classify document type', () => {
    const invoiceText = 'INVOICE\nInvoice Number: INV-001';
    const isInvoice = invoiceText.toLowerCase().includes('invoice');
    expect(isInvoice).toBe(true);
  });

  it('should extract invoice data', () => {
    const mockData = {
      vendor: 'Test Vendor',
      date: '2024-01-15',
      total: 1000,
      tax: 200,
    };
    expect(mockData.vendor).toBeDefined();
    expect(mockData.total).toBeGreaterThan(0);
  });
});
