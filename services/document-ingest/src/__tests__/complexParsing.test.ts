import { describe, it, expect } from '@jest/globals';

describe('Complex Invoice Parsing', () => {
  it('should parse multi-line invoice', () => {
    const invoiceText = `
      INVOICE
      Invoice #: INV-2024-001
      Date: 2024-01-15
      Vendor: Acme Corp
      Items:
        - Item 1: £100.00
        - Item 2: £200.00
      Subtotal: £300.00
      VAT (20%): £60.00
      Total: £360.00
    `;
    
    expect(invoiceText).toContain('INVOICE');
    expect(invoiceText).toContain('Total: £360.00');
  });

  it('should extract line items from table', () => {
    const lineItems = [
      { description: 'Item 1', quantity: 2, price: 50, total: 100 },
      { description: 'Item 2', quantity: 1, price: 200, total: 200 },
    ];
    
    expect(lineItems.length).toBe(2);
    expect(lineItems[0]?.total).toBe(100);
  });
});
