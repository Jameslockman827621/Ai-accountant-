import { jest } from '@jest/globals';
import { DocumentType } from '@ai-accountant/shared-types';

const mockChatCreate = jest.fn().mockResolvedValue({
  choices: [
    {
      message: {
        content: JSON.stringify({
          documentType: 'receipt',
          vendor: 'Corner Shop',
          date: '2024-02-01',
          total: 12.5,
          tax: 2.5,
          currency: 'GBP',
          confidenceScore: 0.77,
        }),
      },
    },
  ],
});

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockChatCreate } },
  }));
});

jest.mock('../fieldExtraction', () => ({
  extractStructuredFields: jest.fn(async () => ({
    vendor: 'Structured Vendor',
    total: 10.5,
    currency: 'GBP',
    invoiceNumber: 'INV-LLM-01',
  })),
}));

import { processClassificationJob } from '../processor';

describe('Classification processor contracts', () => {
  it('uses keyword heuristics for invoice-style documents', async () => {
    const invoiceText = 'INVOICE\nInvoice Number: INV-1001\nTotal: £1,200.00\nVAT: £240.00';

    const result = await processClassificationJob(invoiceText);

    expect(result.documentType).toBe(DocumentType.INVOICE);
    expect(result.confidenceScore).toBeGreaterThan(0.8);
    expect(result.extractedData.invoiceNumber).toMatch(/INV/i);
    expect(result.extractedData.total).toBeGreaterThan(0);
  });

  it('falls back to LLM classification when heuristics are inconclusive', async () => {
    const ambiguousText = 'Payment advice attached with miscellaneous charges.';

    const result = await processClassificationJob(ambiguousText);

    expect(mockChatCreate).toHaveBeenCalled();
    expect(result.documentType).toBe(DocumentType.RECEIPT);
    expect(result.extractedData.vendor).toBe('Corner Shop');
    expect(result.extractedData.total).toBeCloseTo(12.5);
    expect(result.confidenceScore).toBeGreaterThan(0.7);
  });
});
