import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('filing-service');

export interface CorporationTaxFiling {
  accountingPeriodStart: Date;
  accountingPeriodEnd: Date;
  turnover: number;
  profitBeforeTax: number;
  taxableProfit: number;
  corporationTax: number;
  taxRate: number;
}

export async function generateCorporationTaxFiling(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<CorporationTaxFiling> {
  logger.info('Generating Corporation Tax filing', { tenantId, periodStart, periodEnd });

  // Get revenue (credit entries in revenue accounts)
  const revenueResult = await db.query<{
    revenue: number;
  }>(
    `SELECT COALESCE(SUM(amount), 0) as revenue
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
       AND entry_type = 'credit'
       AND account_code LIKE '4%'`,
    [tenantId, periodStart, periodEnd]
  );

  // Get expenses (debit entries in expense accounts)
  const expensesResult = await db.query<{
    expenses: number;
  }>(
    `SELECT COALESCE(SUM(amount), 0) as expenses
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
       AND entry_type = 'debit'
       AND (account_code LIKE '5%' OR account_code LIKE '6%')`,
    [tenantId, periodStart, periodEnd]
  );

  const turnover = typeof revenueResult.rows[0]?.revenue === 'number'
    ? revenueResult.rows[0].revenue
    : parseFloat(String(revenueResult.rows[0]?.revenue || '0'));
  
  const expenses = typeof expensesResult.rows[0]?.expenses === 'number'
    ? expensesResult.rows[0].expenses
    : parseFloat(String(expensesResult.rows[0]?.expenses || '0'));

  const profitBeforeTax = turnover - expenses;
  
  // UK Corporation Tax rates (2023/24)
  // Small profits rate: 19% for profits up to £50,000
  // Main rate: 25% for profits over £250,000
  // Marginal relief for profits between £50,000 and £250,000
  
  let taxRate = 0.19; // Default small profits rate
  let taxableProfit = profitBeforeTax;
  
  if (profitBeforeTax > 250000) {
    taxRate = 0.25;
  } else if (profitBeforeTax > 50000) {
    // Marginal relief calculation (simplified)
    const marginalRelief = (250000 - profitBeforeTax) / 200000 * 0.06;
    taxRate = 0.25 - marginalRelief;
  }
  
  const corporationTax = taxableProfit * taxRate;

  return {
    accountingPeriodStart: periodStart,
    accountingPeriodEnd: periodEnd,
    turnover: Math.round(turnover * 100) / 100,
    profitBeforeTax: Math.round(profitBeforeTax * 100) / 100,
    taxableProfit: Math.round(taxableProfit * 100) / 100,
    corporationTax: Math.round(corporationTax * 100) / 100,
    taxRate: Math.round(taxRate * 10000) / 100, // Percentage
  };
}
