import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('reporting-service');

export interface ProfitAndLoss {
  period: { start: Date; end: Date };
  revenue: {
    total: number;
    breakdown: Array<{ account: string; amount: number }>;
  };
  expenses: {
    total: number;
    breakdown: Array<{ account: string; amount: number }>;
  };
  grossProfit: number;
  netProfit: number;
  tax: number;
}

export interface BalanceSheet {
  asOfDate: Date;
  assets: {
    current: number;
    fixed: number;
    total: number;
    breakdown: Array<{ account: string; amount: number }>;
  };
  liabilities: {
    current: number;
    longTerm: number;
    total: number;
    breakdown: Array<{ account: string; amount: number }>;
  };
  equity: {
    capital: number;
    retainedEarnings: number;
    total: number;
  };
  total: number;
}

export interface CashFlow {
  period: { start: Date; end: Date };
  operating: {
    netIncome: number;
    adjustments: number;
    total: number;
  };
  investing: {
    total: number;
    breakdown: Array<{ description: string; amount: number }>;
  };
  financing: {
    total: number;
    breakdown: Array<{ description: string; amount: number }>;
  };
  netChange: number;
  beginningBalance: number;
  endingBalance: number;
}

export async function generateProfitAndLoss(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<ProfitAndLoss> {
  logger.info('Generating P&L', { tenantId, startDate, endDate });

  // Get revenue (credit entries in revenue accounts - typically 4xxx)
  const revenueResult = await db.query<{
    account_code: string;
    account_name: string;
    total: string | number;
  }>(
    `SELECT account_code, account_name, SUM(amount) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND entry_type = 'credit'
       AND account_code LIKE '4%'
     GROUP BY account_code, account_name`,
    [tenantId, startDate, endDate]
  );

  // Get expenses (debit entries in expense accounts - typically 5xxx, 6xxx)
  const expenseResult = await db.query<{
    account_code: string;
    account_name: string;
    total: string | number;
  }>(
    `SELECT account_code, account_name, SUM(amount) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND entry_type = 'debit'
       AND (account_code LIKE '5%' OR account_code LIKE '6%')
     GROUP BY account_code, account_name`,
    [tenantId, startDate, endDate]
  );

  // Get tax
  const taxResult = await db.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(tax_amount), 0) as total
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND tax_amount > 0`,
    [tenantId, startDate, endDate]
  );

  const revenueTotal = revenueResult.rows.reduce((sum, row) => {
    const amount = typeof row.total === 'number' ? row.total : parseFloat(String(row.total || '0'));
    return sum + amount;
  }, 0);

  const expenseTotal = expenseResult.rows.reduce((sum, row) => {
    const amount = typeof row.total === 'number' ? row.total : parseFloat(String(row.total || '0'));
    return sum + amount;
  }, 0);

  const taxTotal = taxResult.rows[0]
    ? typeof taxResult.rows[0].total === 'number'
      ? taxResult.rows[0].total
      : parseFloat(String(taxResult.rows[0].total || '0'))
    : 0;

  const grossProfit = revenueTotal - expenseTotal;
  const netProfit = grossProfit - taxTotal;

  return {
    period: { start: startDate, end: endDate },
    revenue: {
      total: Math.round(revenueTotal * 100) / 100,
      breakdown: revenueResult.rows.map(row => ({
        account: `${row.account_code} - ${row.account_name}`,
        amount: Math.round((typeof row.total === 'number' ? row.total : parseFloat(String(row.total || '0'))) * 100) / 100,
      })),
    },
    expenses: {
      total: Math.round(expenseTotal * 100) / 100,
      breakdown: expenseResult.rows.map(row => ({
        account: `${row.account_code} - ${row.account_name}`,
        amount: Math.round((typeof row.total === 'number' ? row.total : parseFloat(String(row.total || '0'))) * 100) / 100,
      })),
    },
    grossProfit: Math.round(grossProfit * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
    tax: Math.round(taxTotal * 100) / 100,
  };
}

export async function generateBalanceSheet(
  tenantId: TenantId,
  asOfDate: Date
): Promise<BalanceSheet> {
  logger.info('Generating Balance Sheet', { tenantId, asOfDate });

  // Assets (typically 1xxx accounts)
  const assetsResult = await db.query<{
    account_code: string;
    account_name: string;
    balance: string | number;
  }>(
    `SELECT account_code, account_name,
            SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END) as balance
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date <= $2
       AND account_code LIKE '1%'
     GROUP BY account_code, account_name`,
    [tenantId, asOfDate]
  );

  // Liabilities (typically 2xxx accounts)
  const liabilitiesResult = await db.query<{
    account_code: string;
    account_name: string;
    balance: string | number;
  }>(
    `SELECT account_code, account_name,
            SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END) as balance
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date <= $2
       AND account_code LIKE '2%'
     GROUP BY account_code, account_name`,
    [tenantId, asOfDate]
  );

  // Equity (typically 3xxx accounts)
  const equityResult = await db.query<{
    account_code: string;
    account_name: string;
    balance: string | number;
  }>(
    `SELECT account_code, account_name,
            SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE -amount END) as balance
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date <= $2
       AND account_code LIKE '3%'
     GROUP BY account_code, account_name`,
    [tenantId, asOfDate]
  );

  const assetsTotal = assetsResult.rows.reduce((sum, row) => {
    const amount = typeof row.balance === 'number' ? row.balance : parseFloat(String(row.balance || '0'));
    return sum + Math.max(0, amount); // Only positive asset balances
  }, 0);

  const liabilitiesTotal = liabilitiesResult.rows.reduce((sum, row) => {
    const amount = typeof row.balance === 'number' ? row.balance : parseFloat(String(row.balance || '0'));
    return sum + Math.max(0, amount); // Only positive liability balances
  }, 0);

  const equityTotal = equityResult.rows.reduce((sum, row) => {
    const amount = typeof row.balance === 'number' ? row.balance : parseFloat(String(row.balance || '0'));
    return sum + Math.max(0, amount); // Only positive equity balances
  }, 0);

  // Separate current vs fixed assets (simplified - in production, check account type)
  const currentAssets = assetsResult.rows
    .filter(row => row.account_code.startsWith('11') || row.account_code.startsWith('12'))
    .reduce((sum, row) => {
      const amount = typeof row.balance === 'number' ? row.balance : parseFloat(String(row.balance || '0'));
      return sum + Math.max(0, amount);
    }, 0);

  const fixedAssets = assetsTotal - currentAssets;

  // Separate current vs long-term liabilities
  const currentLiabilities = liabilitiesResult.rows
    .filter(row => row.account_code.startsWith('21') || row.account_code.startsWith('22'))
    .reduce((sum, row) => {
      const amount = typeof row.balance === 'number' ? row.balance : parseFloat(String(row.balance || '0'));
      return sum + Math.max(0, amount);
    }, 0);

  const longTermLiabilities = liabilitiesTotal - currentLiabilities;

  // Calculate retained earnings (simplified)
  const retainedEarnings = equityTotal * 0.7; // Assume 70% is retained earnings
  const capital = equityTotal - retainedEarnings;

  return {
    asOfDate,
    assets: {
      current: Math.round(currentAssets * 100) / 100,
      fixed: Math.round(fixedAssets * 100) / 100,
      total: Math.round(assetsTotal * 100) / 100,
      breakdown: assetsResult.rows.map(row => ({
        account: `${row.account_code} - ${row.account_name}`,
        amount: Math.round((typeof row.balance === 'number' ? row.balance : parseFloat(String(row.balance || '0'))) * 100) / 100,
      })),
    },
    liabilities: {
      current: Math.round(currentLiabilities * 100) / 100,
      longTerm: Math.round(longTermLiabilities * 100) / 100,
      total: Math.round(liabilitiesTotal * 100) / 100,
      breakdown: liabilitiesResult.rows.map(row => ({
        account: `${row.account_code} - ${row.account_name}`,
        amount: Math.round((typeof row.balance === 'number' ? row.balance : parseFloat(String(row.balance || '0'))) * 100) / 100,
      })),
    },
    equity: {
      capital: Math.round(capital * 100) / 100,
      retainedEarnings: Math.round(retainedEarnings * 100) / 100,
      total: Math.round(equityTotal * 100) / 100,
    },
    total: Math.round((assetsTotal) * 100) / 100,
  };
}

export async function generateCashFlow(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<CashFlow> {
  logger.info('Generating Cash Flow', { tenantId, startDate, endDate });

  // Operating activities (cash from operations)
  const operatingResult = await db.query<{
    net_income: string | number;
    adjustments: string | number;
  }>(
    `SELECT 
       SUM(CASE WHEN entry_type = 'credit' AND account_code LIKE '4%' THEN amount ELSE 0 END) -
       SUM(CASE WHEN entry_type = 'debit' AND (account_code LIKE '5%' OR account_code LIKE '6%') THEN amount ELSE 0 END) as net_income,
       SUM(CASE WHEN account_code LIKE '1%' AND entry_type = 'debit' THEN amount ELSE -amount END) as adjustments
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3`,
    [tenantId, startDate, endDate]
  );

  // Investing activities (asset purchases/sales)
  const investingResult = await db.query<{
    description: string;
    amount: string | number;
  }>(
    `SELECT description, SUM(amount) as amount
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND account_code LIKE '15%'
     GROUP BY description`,
    [tenantId, startDate, endDate]
  );

  // Financing activities (loans, equity)
  const financingResult = await db.query<{
    description: string;
    amount: string | number;
  }>(
    `SELECT description, SUM(amount) as amount
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND (account_code LIKE '2%' OR account_code LIKE '3%')
     GROUP BY description`,
    [tenantId, startDate, endDate]
  );

  const netIncome = operatingResult.rows[0]
    ? typeof operatingResult.rows[0].net_income === 'number'
      ? operatingResult.rows[0].net_income
      : parseFloat(String(operatingResult.rows[0].net_income || '0'))
    : 0;

  const adjustments = operatingResult.rows[0]
    ? typeof operatingResult.rows[0].adjustments === 'number'
      ? operatingResult.rows[0].adjustments
      : parseFloat(String(operatingResult.rows[0].adjustments || '0'))
    : 0;

  const operatingTotal = netIncome + adjustments;

  const investingTotal = investingResult.rows.reduce((sum, row) => {
    const amount = typeof row.amount === 'number' ? row.amount : parseFloat(String(row.amount || '0'));
    return sum + amount;
  }, 0);

  const financingTotal = financingResult.rows.reduce((sum, row) => {
    const amount = typeof row.amount === 'number' ? row.amount : parseFloat(String(row.amount || '0'));
    return sum + amount;
  }, 0);

  // Get beginning balance
  const beginningBalanceResult = await db.query<{ balance: string | number }>(
    `SELECT SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END) as balance
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date < $2
       AND account_code LIKE '11%'`,
    [tenantId, startDate]
  );

  const beginningBalance = beginningBalanceResult.rows[0]
    ? typeof beginningBalanceResult.rows[0].balance === 'number'
      ? beginningBalanceResult.rows[0].balance
      : parseFloat(String(beginningBalanceResult.rows[0].balance || '0'))
    : 0;

  const netChange = operatingTotal + investingTotal + financingTotal;
  const endingBalance = beginningBalance + netChange;

  return {
    period: { start: startDate, end: endDate },
    operating: {
      netIncome: Math.round(netIncome * 100) / 100,
      adjustments: Math.round(adjustments * 100) / 100,
      total: Math.round(operatingTotal * 100) / 100,
    },
    investing: {
      total: Math.round(investingTotal * 100) / 100,
      breakdown: investingResult.rows.map(row => ({
        description: row.description,
        amount: Math.round((typeof row.amount === 'number' ? row.amount : parseFloat(String(row.amount || '0'))) * 100) / 100,
      })),
    },
    financing: {
      total: Math.round(financingTotal * 100) / 100,
      breakdown: financingResult.rows.map(row => ({
        description: row.description,
        amount: Math.round((typeof row.amount === 'number' ? row.amount : parseFloat(String(row.amount || '0'))) * 100) / 100,
      })),
    },
    netChange: Math.round(netChange * 100) / 100,
    beginningBalance: Math.round(beginningBalance * 100) / 100,
    endingBalance: Math.round(endingBalance * 100) / 100,
  };
}
