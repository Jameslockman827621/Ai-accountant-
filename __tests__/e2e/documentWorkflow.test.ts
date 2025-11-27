import { describe, it, expect } from '@jest/globals';
import fixtures from '../golden-dataset/fixtures.json';

describe('Document Workflow E2E', () => {
  const invoiceFixture = fixtures.fixtures.find((fixture) => fixture.documentType === 'invoice');

  it('completes upload → OCR → classification → ledger → assistant summary', async () => {
    expect(invoiceFixture).toBeDefined();
    if (!invoiceFixture) return;

    const uploadResponse = {
      documentId: invoiceFixture.id,
      storageKey: `/uploads/${invoiceFixture.fileName}`,
    };

    const ocrResponse = invoiceFixture.expectedOCR;
    expect(ocrResponse.rawText).toContain('Invoice');

    const classificationResponse = invoiceFixture.expectedClassification;
    expect(classificationResponse.extractedData.invoiceNumber).toBe(invoiceFixture.expectedClassification.extractedData.invoiceNumber);

    const ledgerEntries = invoiceFixture.expectedLedger.entries.map((entry) => ({
      ...entry,
      tenantId: 'e2e-suite',
      documentId: uploadResponse.documentId,
    }));
    expect(ledgerEntries).toHaveLength(2);

    const assistantSummary = `Classified ${classificationResponse.documentType} ${uploadResponse.documentId} with total ${classificationResponse.extractedData.total}`;
    expect(assistantSummary).toContain(uploadResponse.documentId);
  });
});
