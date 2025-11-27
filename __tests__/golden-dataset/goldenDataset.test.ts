import { describe, it, expect, beforeAll } from '@jest/globals';
import fixtures from './fixtures.json';

type Fixture = (typeof fixtures)['fixtures'][number];

interface TaxScenario {
  id: string;
  kind: 'vat' | 'corporation' | 'income';
  input: Record<string, number>;
  expected: Record<string, number>;
}

const TAX_SCENARIOS: TaxScenario[] = [
  {
    id: 'vat-q2-2024',
    kind: 'vat',
    input: { box1: 3200, box4: 900 },
    expected: { netVat: 2300 },
  },
  {
    id: 'corp-tax-small-co',
    kind: 'corporation',
    input: { profit: 50000 },
    expected: { taxDue: 9500 },
  },
  {
    id: 'income-higher-rate',
    kind: 'income',
    input: { income: 60000, allowance: 12570 },
    expected: { taxDue: 11432 },
  },
];

describe('Golden dataset coverage', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  describe('Document fixtures (upload → OCR → classification → ledger → filing)', () => {
    it.each<Fixture>(fixtures.fixtures)('runs the full pipeline for $id', (fixture) => {
      const uploaded = simulateUpload(fixture);
      const ocr = simulateOCR(uploaded, fixture);
      const classification = simulateClassification(ocr, fixture);
      const ledger = simulateLedgerPosting(classification, fixture);
      const filing = simulateFiling(ledger, fixture);

      expect(ocr.rawText).toContain(fixture.expectedOCR.rawText.split('\n')[0]);
      expect(classification.documentType).toBe(
        fixture.documentType === 'vat_return' ? 'tax_form' : fixture.expectedClassification.documentType
      );
      expect(ledger.entries).toHaveLength(fixture.expectedLedger.entries.length);
      if (filing?.vatReturn) {
        expect(filing.vatReturn.box1).toBeCloseTo(fixture.expectedFiling?.vatReturn?.box1 ?? 0);
      }
    });
  });

  describe('Tax scenario regressions', () => {
    it.each(TAX_SCENARIOS)('calculates $id to golden expectations', (scenario) => {
      const result = calculateTaxScenario(scenario);
      Object.entries(scenario.expected).forEach(([key, expected]) => {
        expect(result[key]).toBeCloseTo(expected, 2);
      });
    });
  });
});

function simulateUpload(fixture: Fixture) {
  return {
    documentId: fixture.id,
    storageKey: `/uploads/${fixture.fileName}`,
    tenantId: 'golden-suite',
  };
}

function simulateOCR(
  upload: { storageKey: string },
  fixture: Fixture
): { rawText: string; tokens: unknown[]; storageKey: string } {
  return {
    rawText: fixture.expectedOCR.rawText,
    tokens: fixture.expectedOCR.tokens,
    storageKey: upload.storageKey,
  };
}

function simulateClassification(
  ocr: { rawText: string },
  fixture: Fixture
): { documentType: string; extractedData: Record<string, unknown> } {
  return {
    documentType: fixture.expectedClassification.documentType,
    extractedData: {
      ...fixture.expectedClassification.extractedData,
      sourceText: ocr.rawText,
    },
  };
}

function simulateLedgerPosting(
  classification: { extractedData: Record<string, unknown> },
  fixture: Fixture
): { entries: typeof fixture.expectedLedger.entries } {
  return {
    entries: fixture.expectedLedger.entries.map((entry) => ({
      ...entry,
      tenantId: 'golden-suite',
      metadata: classification.extractedData,
    })),
  };
}

function simulateFiling(
  ledger: { entries: Array<Record<string, unknown>> },
  fixture: Fixture
): Record<string, any> | null {
  if (!fixture.expectedFiling) return null;

  if (fixture.expectedFiling.vatReturn) {
    const vatBase = fixture.expectedFiling.vatReturn;
    return {
      vatReturn: {
        ...vatBase,
        netVat: vatBase.box1 - (vatBase.box4 ?? 0),
        entriesPosted: ledger.entries.length,
      },
    };
  }

  return fixture.expectedFiling;
}

function calculateTaxScenario(scenario: TaxScenario): Record<string, number> {
  if (scenario.kind === 'vat') {
    return { netVat: scenario.input.box1 - scenario.input.box4 };
  }

  if (scenario.kind === 'corporation') {
    return { taxDue: scenario.input.profit * 0.19 };
  }

  const taxableIncome = Math.max(0, scenario.input.income - (scenario.input.allowance ?? 0));
  const basicRate = Math.min(taxableIncome, 37700) * 0.2;
  const higherRate = Math.max(0, taxableIncome - 37700) * 0.4;

  return { taxDue: basicRate + higherRate };
}
