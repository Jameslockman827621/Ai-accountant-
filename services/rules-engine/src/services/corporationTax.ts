import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('rules-engine-service');

export interface CorporationTaxCalculationResult {
  period: { start: Date; end: Date };
  profitBeforeTax: number;
  adjustments: {
    depreciation: number;
    disallowableExpenses: number;
    capitalAllowances: number;
    other: number;
  };
  taxableProfit: number;
  corporationTaxRate: number;
  corporationTax: number;
  breakdown: {
    revenue: number;
    costOfSales: number;
    grossProfit: number;
    operatingExpenses: number;
    operatingProfit: number;
    otherIncome: number;
    otherExpenses: number;
  };
}

// UK Corporation Tax Rates 2024-25
const CT_RATES = {
  mainRate: 0.25, // 25% for profits over £250,000
  smallProfitsRate: 0.19, // 19% for profits up to £50,000
  marginalRelief: {
    lowerLimit: 50000,
    upperLimit: 250000,
    fraction: 0.015, // Marginal relief fraction
  },
};

export async function calculateCorporationTax(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<CorporationTaxCalculationResult> {
  logger.info('Calculating Corporation Tax', { tenantId, periodStart, periodEnd });

  // Get revenue (credit entries in revenue accounts)
  const revenueResult = await db.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND entry_type = 'credit'
       AND account_code LIKE '4%'`,
    [tenantId, periodStart, periodEnd]
  );

  // Get cost of sales
  const costOfSalesResult = await db.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND entry_type = 'debit'
       AND account_code LIKE '5%'`,
    [tenantId, periodStart, periodEnd]
  );

  // Get operating expenses
  const operatingExpensesResult = await db.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND entry_type = 'debit'
       AND account_code LIKE '6%'`,
    [tenantId, periodStart, periodEnd]
  );

  // Get other income
  const otherIncomeResult = await db.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND entry_type = 'credit'
       AND account_code LIKE '8%'`,
    [tenantId, periodStart, periodEnd]
  );

  // Get other expenses
  const otherExpensesResult = await db.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND entry_type = 'debit'
       AND account_code LIKE '9%'`,
    [tenantId, periodStart, periodEnd]
  );

  const revenue = parseFloat(String(revenueResult.rows[0]?.total || '0'));
  const costOfSales = parseFloat(String(costOfSalesResult.rows[0]?.total || '0'));
  const operatingExpenses = parseFloat(String(operatingExpensesResult.rows[0]?.total || '0'));
  const otherIncome = parseFloat(String(otherIncomeResult.rows[0]?.total || '0'));
  const otherExpenses = parseFloat(String(otherExpensesResult.rows[0]?.total || '0'));

  const grossProfit = revenue - costOfSales;
  const operatingProfit = grossProfit - operatingExpenses;
  const profitBeforeTax = operatingProfit + otherIncome - otherExpenses;

  // Calculate adjustments (simplified - in production, use actual tax adjustments)
  const depreciation = operatingExpenses * 0.1; // Assume 10% of expenses is depreciation
  const capitalAllowances = depreciation * 1.2; // Capital allowances are typically higher
  const disallowableExpenses = operatingExpenses * 0.05; // Assume 5% disallowable

  const taxableProfit = profitBeforeTax + disallowableExpenses - capitalAllowances;

  // Calculate corporation tax
  let corporationTax = 0;
  let taxRate = CT_RATES.mainRate;

  if (taxableProfit <= CT_RATES.marginalRelief.lowerLimit) {
    // Small profits rate
    corporationTax = taxableProfit * CT_RATES.smallProfitsRate;
    taxRate = CT_RATES.smallProfitsRate;
  } else if (taxableProfit >= CT_RATES.marginalRelief.upperLimit) {
    // Main rate
    corporationTax = taxableProfit * CT_RATES.mainRate;
    taxRate = CT_RATES.mainRate;
  } else {
    // Marginal relief
    const marginalRelief = (CT_RATES.marginalRelief.upperLimit - taxableProfit) * CT_RATES.marginalRelief.fraction;
    corporationTax = (taxableProfit * CT_RATES.mainRate) - marginalRelief;
    taxRate = corporationTax / taxableProfit;
  }

  logger.info('Corporation tax calculation completed', {
    tenantId,
    profitBeforeTax,
    taxableProfit,
    corporationTax,
  });

  return {
    period: { start: periodStart, end: periodEnd },
    profitBeforeTax: Math.round(profitBeforeTax * 100) / 100,
    adjustments: {
      depreciation: Math.round(depreciation * 100) / 100,
      disallowableExpenses: Math.round(disallowableExpenses * 100) / 100,
      capitalAllowances: Math.round(capitalAllowances * 100) / 100,
      other: 0,
    },
    taxableProfit: Math.round(taxableProfit * 100) / 100,
    corporationTaxRate: Math.round(taxRate * 10000) / 100, // As percentage
    corporationTax: Math.round(corporationTax * 100) / 100,
    breakdown: {
      revenue: Math.round(revenue * 100) / 100,
      costOfSales: Math.round(costOfSales * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      operatingExpenses: Math.round(operatingExpenses * 100) / 100,
      operatingProfit: Math.round(operatingProfit * 100) / 100,
      otherIncome: Math.round(otherIncome * 100) / 100,
      otherExpenses: Math.round(otherExpenses * 100) / 100,
    },
  };
}
