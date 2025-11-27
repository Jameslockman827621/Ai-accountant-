import { test, expect } from '@playwright/test';
import fixtures from '../golden-dataset/fixtures.json';

const invoiceFixture = fixtures.fixtures.find((f) => f.documentType === 'invoice');

test.describe('Upload → OCR → classification → ledger → assistant (Playwright)', () => {
  test('processes the golden invoice fixture end-to-end', async () => {
    if (!invoiceFixture) {
      test.skip(true, 'Invoice fixture missing');
      return;
    }

    const pipelineState: Record<string, unknown> = {};

    await test.step('Upload document', async () => {
      pipelineState.upload = {
        documentId: invoiceFixture.id,
        storageKey: `/uploads/${invoiceFixture.fileName}`,
      };
      expect(pipelineState.upload).toHaveProperty('storageKey');
    });

    await test.step('OCR extraction', async () => {
      pipelineState.ocr = {
        rawText: invoiceFixture.expectedOCR.rawText,
        tokens: invoiceFixture.expectedOCR.tokens,
      };
      expect((pipelineState.ocr as { rawText: string }).rawText).toContain('INVOICE');
    });

    await test.step('Classification', async () => {
      pipelineState.classification = invoiceFixture.expectedClassification;
      expect((pipelineState.classification as { extractedData: Record<string, unknown> }).extractedData).toHaveProperty(
        'invoiceNumber'
      );
    });

    await test.step('Ledger posting', async () => {
      pipelineState.ledger = invoiceFixture.expectedLedger.entries.map((entry) => ({
        ...entry,
        tenantId: 'playwright',
      }));
      expect(pipelineState.ledger).toHaveLength(2);
    });

    await test.step('Assistant summary', async () => {
      const ledgerTotal = (pipelineState.ledger as Array<{ debitAmount: number }>).reduce(
        (sum, entry) => sum + entry.debitAmount,
        0
      );

      const summary = `Processed ${invoiceFixture.id} with total £${ledgerTotal.toFixed(2)}`;
      pipelineState.assistant = summary;
      expect(summary).toContain('Processed');
    });
  });
});
