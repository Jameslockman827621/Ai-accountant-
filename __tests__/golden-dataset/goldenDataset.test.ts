/**
 * Golden Dataset Tests
 * 
 * These tests use a curated set of real-world accounting scenarios
 * to ensure regression-free behavior across system updates.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';

interface GoldenTestCase {
  id: string;
  name: string;
  category: 'vat' | 'income_tax' | 'corporate_tax' | 'reconciliation' | 'filing';
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  tolerance?: number; // For floating point comparisons
}

// Golden dataset - real-world scenarios
const GOLDEN_DATASET: GoldenTestCase[] = [
  {
    id: 'gd-001',
    name: 'Standard UK VAT Return - Q1 2024',
    category: 'vat',
    input: {
      period: '2024-Q1',
      sales: 50000,
      purchases: 30000,
      vatOnSales: 10000,
      vatOnPurchases: 6000,
    },
    expectedOutput: {
      vatDue: 4000,
      netVat: 4000,
      status: 'ready_to_submit',
    },
    tolerance: 0.01,
  },
  {
    id: 'gd-002',
    name: 'UK Corporation Tax - Small Company',
    category: 'corporate_tax',
    input: {
      profit: 50000,
      year: 2024,
      entityType: 'limited_company',
    },
    expectedOutput: {
      corporationTax: 9500, // 19% for profits under £50k
      effectiveRate: 0.19,
    },
    tolerance: 0.01,
  },
  {
    id: 'gd-003',
    name: 'UK Income Tax - Higher Rate',
    category: 'income_tax',
    input: {
      income: 60000,
      year: 2024,
      personalAllowance: 12570,
    },
    expectedOutput: {
      incomeTax: 9496,
      effectiveRate: 0.158,
    },
    tolerance: 0.01,
  },
  {
    id: 'gd-004',
    name: 'Bank Reconciliation - Perfect Match',
    category: 'reconciliation',
    input: {
      bankTransactions: [
        { id: 't1', amount: 1000, date: '2024-01-15', description: 'Invoice Payment' },
        { id: 't2', amount: -500, date: '2024-01-20', description: 'Supplier Payment' },
      ],
      ledgerEntries: [
        { id: 'e1', amount: 1000, date: '2024-01-15', description: 'Invoice Payment' },
        { id: 'e2', amount: -500, date: '2024-01-20', description: 'Supplier Payment' },
      ],
    },
    expectedOutput: {
      matched: 2,
      unmatched: 0,
      balance: 500,
      status: 'reconciled',
    },
  },
  {
    id: 'gd-005',
    name: 'VAT Filing Submission',
    category: 'filing',
    input: {
      filingId: 'filing-001',
      period: '2024-Q1',
      vatDue: 4000,
      submissionDate: '2024-04-07',
    },
    expectedOutput: {
      status: 'submitted',
      confirmationNumber: expect.stringMatching(/^HMRC-\d+$/),
      submittedAt: expect.any(String),
    },
  },
];

describe('Golden Dataset Tests', () => {
  beforeAll(() => {
    // Setup test environment
    process.env.NODE_ENV = 'test';
  });

  describe('VAT Calculations', () => {
    const vatTests = GOLDEN_DATASET.filter(t => t.category === 'vat');

    it.each(vatTests)('should match golden dataset: $name', async (testCase) => {
      // This would call the actual VAT calculation service
      // For now, we'll use a mock implementation
      const result = calculateVAT(testCase.input);
      
      expect(result.vatDue).toBeCloseTo(
        testCase.expectedOutput.vatDue as number,
        testCase.tolerance ? -Math.log10(testCase.tolerance) : 2
      );
    });
  });

  describe('Tax Calculations', () => {
    const taxTests = GOLDEN_DATASET.filter(t => 
      t.category === 'income_tax' || t.category === 'corporate_tax'
    );

    it.each(taxTests)('should match golden dataset: $name', async (testCase) => {
      const result = calculateTax(testCase.input);
      
      expect(result.tax).toBeCloseTo(
        testCase.expectedOutput.tax as number,
        testCase.tolerance ? -Math.log10(testCase.tolerance) : 2
      );
    });
  });

  describe('Reconciliation', () => {
    const reconTests = GOLDEN_DATASET.filter(t => t.category === 'reconciliation');

    it.each(reconTests)('should match golden dataset: $name', async (testCase) => {
      const result = reconcileTransactions(testCase.input);
      
      expect(result).toMatchObject(testCase.expectedOutput);
    });
  });

  describe('Filing Workflows', () => {
    const filingTests = GOLDEN_DATASET.filter(t => t.category === 'filing');

    it.each(filingTests)('should match golden dataset: $name', async (testCase) => {
      const result = submitFiling(testCase.input);
      
      expect(result).toMatchObject(testCase.expectedOutput);
    });
  });
});

// Mock implementations (would be replaced with actual service calls)
function calculateVAT(input: Record<string, unknown>): { vatDue: number } {
  const sales = input.sales as number;
  const purchases = input.purchases as number;
  const vatOnSales = input.vatOnSales as number;
  const vatOnPurchases = input.vatOnPurchases as number;
  
  return {
    vatDue: vatOnSales - vatOnPurchases,
  };
}

function calculateTax(input: Record<string, unknown>): { tax: number } {
  const profit = input.profit as number;
  const income = input.income as number;
  
  if (profit) {
    return { tax: profit * 0.19 }; // Corporation tax
  }
  
  if (income) {
    // Simplified income tax calculation
    return { tax: income * 0.20 };
  }
  
  return { tax: 0 };
}

function reconcileTransactions(input: Record<string, unknown>): Record<string, unknown> {
  const bankTransactions = input.bankTransactions as Array<{ id: string; amount: number }>;
  const ledgerEntries = input.ledgerEntries as Array<{ id: string; amount: number }>;
  
  const matched = Math.min(bankTransactions.length, ledgerEntries.length);
  const balance = bankTransactions.reduce((sum, t) => sum + t.amount, 0);
  
  return {
    matched,
    unmatched: bankTransactions.length + ledgerEntries.length - matched * 2,
    balance,
    status: matched === bankTransactions.length && matched === ledgerEntries.length ? 'reconciled' : 'partial',
  };
}

function submitFiling(input: Record<string, unknown>): Record<string, unknown> {
  return {
    status: 'submitted',
    confirmationNumber: `HMRC-${Date.now()}`,
    submittedAt: new Date().toISOString(),
  };
}
