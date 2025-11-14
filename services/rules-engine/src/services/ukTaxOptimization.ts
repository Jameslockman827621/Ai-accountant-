import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';
import { getEntityTaxProfile } from './ukTaxEntities';
import { calculateIncomeTax, calculateCorporationTax } from './ukTaxCalculations';
import { calculateAllReliefs } from './ukTaxReliefs';

const logger = createLogger('rules-engine-service');

export interface TaxOptimizationStrategy {
  id: string;
  name: string;
  description: string;
  category: 'income' | 'expense' | 'investment' | 'structure' | 'timing' | 'relief';
  applicable: boolean;
  potentialSaving: number;
  implementation: {
    difficulty: 'easy' | 'medium' | 'hard';
    timeRequired: string;
    cost: number;
    steps: string[];
  };
  risks: string[];
  compliance: {
    hmrcApproved: boolean;
    requiresDisclosure: boolean;
    notes: string;
  };
}

export interface TaxOptimizationReport {
  tenantId: TenantId;
  currentYear: string;
  currentTaxLiability: number;
  optimizedTaxLiability: number;
  potentialSaving: number;
  strategies: TaxOptimizationStrategy[];
  recommendations: {
    immediate: TaxOptimizationStrategy[];
    shortTerm: TaxOptimizationStrategy[];
    longTerm: TaxOptimizationStrategy[];
  };
  warnings: string[];
}

export async function generateTaxOptimizationReport(
  tenantId: TenantId,
  taxYear: string = '2024-25'
): Promise<TaxOptimizationReport> {
  const profile = await getEntityTaxProfile(tenantId);
  const strategies: TaxOptimizationStrategy[] = [];
  const warnings: string[] = [];

  // Get current financial data
  const financialData = await getFinancialData(tenantId, taxYear);

  // Calculate current tax liability
  const currentTaxLiability = await calculateCurrentTaxLiability(tenantId, financialData);

  // Generate optimization strategies
  await generateIncomeOptimizationStrategies(tenantId, profile, financialData, strategies);
  await generateExpenseOptimizationStrategies(tenantId, profile, financialData, strategies);
  await generateInvestmentStrategies(tenantId, profile, financialData, strategies);
  await generateStructureStrategies(tenantId, profile, financialData, strategies);
  await generateTimingStrategies(tenantId, profile, financialData, strategies);
  await generateReliefStrategies(tenantId, profile, financialData, strategies);

  // Calculate optimized tax liability
  const optimizedTaxLiability = currentTaxLiability - 
    strategies.reduce((sum, s) => sum + s.potentialSaving, 0);

  const potentialSaving = currentTaxLiability - optimizedTaxLiability;

  // Categorize strategies
  const immediate = strategies.filter(s => s.implementation.difficulty === 'easy' && s.potentialSaving > 100);
  const shortTerm = strategies.filter(s => s.implementation.difficulty === 'medium' && s.potentialSaving > 500);
  const longTerm = strategies.filter(s => s.implementation.difficulty === 'hard' || s.potentialSaving > 5000);

  return {
    tenantId,
    currentYear: taxYear,
    currentTaxLiability,
    optimizedTaxLiability,
    potentialSaving,
    strategies,
    recommendations: {
      immediate,
      shortTerm,
      longTerm,
    },
    warnings,
  };
}

async function getFinancialData(tenantId: TenantId, taxYear: string): Promise<{
  revenue: number;
  expenses: number;
  profit: number;
  salary: number;
  dividends: number;
  capitalExpenditure: number;
  rndExpenditure: number;
}> {
  const yearStart = new Date(parseInt(taxYear.split('-')[0]), 3, 6); // 6 April
  const yearEnd = new Date(parseInt(taxYear.split('-')[1]), 3, 5); // 5 April

  const revenueResult = await db.query<{ revenue: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) as revenue
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'credit'
       AND account_code LIKE '4%'
       AND transaction_date >= $2
       AND transaction_date <= $3`,
    [tenantId, yearStart, yearEnd]
  );

  const expensesResult = await db.query<{ expenses: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) as expenses
     FROM ledger_entries
     WHERE tenant_id = $1
       AND entry_type = 'debit'
       AND (account_code LIKE '5%' OR account_code LIKE '6%')
       AND transaction_date >= $2
       AND transaction_date <= $3`,
    [tenantId, yearStart, yearEnd]
  );

  const revenue = typeof revenueResult.rows[0]?.revenue === 'number'
    ? revenueResult.rows[0].revenue
    : parseFloat(String(revenueResult.rows[0]?.revenue || '0'));

  const expenses = typeof expensesResult.rows[0]?.expenses === 'number'
    ? expensesResult.rows[0].expenses
    : parseFloat(String(expensesResult.rows[0]?.expenses || '0'));

  return {
    revenue,
    expenses,
    profit: revenue - expenses,
    salary: 0, // Would calculate from PAYE
    dividends: 0, // Would calculate from dividend payments
    capitalExpenditure: 0, // Would calculate from capital purchases
    rndExpenditure: 0, // Would calculate from R&D expenses
  };
}

async function calculateCurrentTaxLiability(
  tenantId: TenantId,
  financialData: { revenue: number; expenses: number; profit: number; salary: number; dividends: number }
): Promise<number> {
  const profile = await getEntityTaxProfile(tenantId);

  if (profile.corporationTax.applicable) {
    const ct = await calculateCorporationTax(tenantId, financialData.profit);
    return ct.corporationTax;
  } else {
    const it = await calculateIncomeTax(tenantId, financialData.revenue, financialData.dividends);
    return it.totalTax;
  }
}

async function generateIncomeOptimizationStrategies(
  tenantId: TenantId,
  profile: any,
  data: any,
  strategies: TaxOptimizationStrategy[]
): Promise<void> {
  // Salary vs Dividend optimization for Ltd companies
  if (profile.entityType === 'ltd' && data.profit > 50000) {
    const currentTax = await calculateCorporationTax(tenantId, data.profit);
    const salaryTax = await calculateIncomeTax(tenantId, data.profit, 0);
    
    // Optimal mix: Take salary up to personal allowance, rest as dividends
    const optimalSalary = 12570; // Personal allowance
    const optimalDividends = data.profit - optimalSalary;
    
    const optimalCT = await calculateCorporationTax(tenantId, data.profit - optimalSalary);
    const optimalIT = await calculateIncomeTax(tenantId, optimalSalary, optimalDividends);
    
    const saving = (currentTax.corporationTax + salaryTax.totalTax) - 
      (optimalCT.corporationTax + optimalIT.totalTax);

    if (saving > 0) {
      strategies.push({
        id: 'INC001',
        name: 'Salary vs Dividend Optimization',
        description: 'Optimize mix of salary and dividends to minimize overall tax',
        category: 'income',
        applicable: true,
        potentialSaving: saving,
        implementation: {
          difficulty: 'medium',
          timeRequired: '1-2 weeks',
          cost: 0,
          steps: [
            'Set salary to personal allowance (£12,570)',
            'Take remaining profit as dividends',
            'Update PAYE and dividend records',
          ],
        },
        risks: ['Must maintain minimum wage if director', 'Dividend tax rates may change'],
        compliance: {
          hmrcApproved: true,
          requiresDisclosure: false,
          notes: 'Legal tax planning strategy',
        },
      });
    }
  }
}

async function generateExpenseOptimizationStrategies(
  tenantId: TenantId,
  profile: any,
  data: any,
  strategies: TaxOptimizationStrategy[]
): Promise<void> {
  // Annual Investment Allowance
  if (data.capitalExpenditure > 0 && data.capitalExpenditure < 1000000) {
    const aia = await calculateAllReliefs(tenantId, {
      aiaExpenditure: data.capitalExpenditure,
    });

    if (aia.aia && aia.aia.taxSaving > 0) {
      strategies.push({
        id: 'EXP001',
        name: 'Annual Investment Allowance',
        description: 'Claim full Annual Investment Allowance on capital expenditure',
        category: 'expense',
        applicable: true,
        potentialSaving: aia.aia.taxSaving,
        implementation: {
          difficulty: 'easy',
          timeRequired: '1 day',
          cost: 0,
          steps: [
            'Ensure capital expenditure is properly categorized',
            'Claim AIA in Corporation Tax return',
          ],
        },
        risks: [],
        compliance: {
          hmrcApproved: true,
          requiresDisclosure: false,
          notes: 'Standard capital allowance',
        },
      });
    }
  }

  // Home office expenses
  if (data.expenses > 0) {
    strategies.push({
      id: 'EXP002',
      name: 'Home Office Expenses',
      description: 'Claim allowable home office expenses if working from home',
      category: 'expense',
      applicable: true,
      potentialSaving: 200, // Estimated
      implementation: {
        difficulty: 'easy',
        timeRequired: '1 hour',
        cost: 0,
        steps: [
          'Calculate home office usage percentage',
          'Claim proportion of utilities, rent, etc.',
          'Keep records of calculations',
        ],
      },
      risks: ['Must be exclusively for business use'],
      compliance: {
        hmrcApproved: true,
        requiresDisclosure: false,
        notes: 'Simplified expenses or actual costs',
      },
    });
  }
}

async function generateInvestmentStrategies(
  tenantId: TenantId,
  profile: any,
  data: any,
  strategies: TaxOptimizationStrategy[]
): Promise<void> {
  // Pension contributions
  if (data.profit > 50000) {
    const pensionAllowance = profile.reliefs.pensionAnnualAllowance;
    const currentContributions = 0; // Would get from records

    if (currentContributions < pensionAllowance) {
      const available = pensionAllowance - currentContributions;
      const taxSaving = available * 0.20; // Basic rate relief

      strategies.push({
        id: 'INV001',
        name: 'Pension Contributions',
        description: `Increase pension contributions to maximize tax relief (up to £${pensionAllowance.toLocaleString()} annual allowance)`,
        category: 'investment',
        applicable: true,
        potentialSaving: taxSaving,
        implementation: {
          difficulty: 'easy',
          timeRequired: '1 day',
          cost: available,
          steps: [
            'Set up pension scheme if not already',
            'Make additional contributions',
            'Claim tax relief in tax return',
          ],
        },
        risks: ['Money locked until retirement age'],
        compliance: {
          hmrcApproved: true,
          requiresDisclosure: false,
          notes: 'Standard pension tax relief',
        },
      });
    }
  }

  // EIS/SEIS investments
  if (data.profit > 100000) {
    strategies.push({
      id: 'INV002',
      name: 'EIS Investment',
      description: 'Invest in EIS-qualifying companies for 30% income tax relief',
      category: 'investment',
      applicable: true,
      potentialSaving: 60000, // 30% of £200k max
      implementation: {
        difficulty: 'hard',
        timeRequired: '2-4 weeks',
        cost: 200000,
        steps: [
          'Identify qualifying EIS companies',
          'Make investment',
          'Claim tax relief in tax return',
        ],
      },
      risks: ['Investment risk', 'Must hold for 3 years'],
      compliance: {
        hmrcApproved: true,
        requiresDisclosure: true,
        notes: 'Requires EIS3 certificate from company',
      },
    });
  }
}

async function generateStructureStrategies(
  tenantId: TenantId,
  profile: any,
  data: any,
  strategies: TaxOptimizationStrategy[]
): Promise<void> {
  // Sole trader to Ltd conversion
  if (profile.entityType === 'sole_trader' && data.profit > 50000) {
    const currentTax = await calculateIncomeTax(tenantId, data.profit);
    const ni = await calculateNationalInsurance(tenantId, data.profit);
    const currentTotal = currentTax.totalTax + ni.total;

    const ltdCT = await calculateCorporationTax(tenantId, data.profit);
    const ltdSalary = await calculateIncomeTax(tenantId, 12570, 0);
    const ltdDividends = await calculateIncomeTax(tenantId, 0, data.profit - 12570 - ltdCT.corporationTax);
    const ltdTotal = ltdCT.corporationTax + ltdSalary.totalTax + ltdDividends.totalTax;

    const saving = currentTotal - ltdTotal;

    if (saving > 1000) {
      strategies.push({
        id: 'STR001',
        name: 'Incorporate as Limited Company',
        description: 'Convert from sole trader to Ltd company to reduce tax liability',
        category: 'structure',
        applicable: true,
        potentialSaving: saving,
        implementation: {
          difficulty: 'hard',
          timeRequired: '4-6 weeks',
          cost: 1000, // Incorporation costs
          steps: [
            'Incorporate company at Companies House',
            'Transfer business assets',
            'Set up PAYE and Corporation Tax',
            'Update all registrations',
          ],
        },
        risks: ['Administrative burden', 'Different filing requirements'],
        compliance: {
          hmrcApproved: true,
          requiresDisclosure: true,
          notes: 'Must follow proper incorporation process',
        },
      });
    }
  }
}

async function generateTimingStrategies(
  tenantId: TenantId,
  profile: any,
  data: any,
  strategies: TaxOptimizationStrategy[]
): Promise<void> {
  // Income deferral
  if (profile.entityType === 'ltd' && data.profit > 50000) {
    strategies.push({
      id: 'TIM001',
      name: 'Income Deferral',
      description: 'Defer income to next tax year if close to year end',
      category: 'timing',
      applicable: true,
      potentialSaving: data.profit * 0.19 * 0.25, // CT rate * time value
      implementation: {
        difficulty: 'medium',
        timeRequired: '1 week',
        cost: 0,
        steps: [
          'Delay invoicing until after year end',
          'Ensure cash flow allows for deferral',
        ],
      },
      risks: ['Cash flow impact', 'Customer payment delays'],
      compliance: {
        hmrcApproved: true,
        requiresDisclosure: false,
        notes: 'Legal timing strategy',
      },
    });
  }

  // Expense acceleration
  if (data.profit > 0) {
    strategies.push({
      id: 'TIM002',
      name: 'Expense Acceleration',
      description: 'Bring forward planned expenses to current tax year',
      category: 'timing',
      applicable: true,
      potentialSaving: 1000, // Estimated
      implementation: {
        difficulty: 'easy',
        timeRequired: '1 day',
        cost: 0,
        steps: [
          'Identify planned expenses for next year',
          'Make purchases before year end',
          'Ensure expenses are legitimate',
        ],
      },
      risks: ['Cash flow impact'],
      compliance: {
        hmrcApproved: true,
        requiresDisclosure: false,
        notes: 'Standard timing strategy',
      },
    });
  }
}

async function generateReliefStrategies(
  tenantId: TenantId,
  profile: any,
  data: any,
  strategies: TaxOptimizationStrategy[]
): Promise<void> {
  // R&D Tax Relief
  if (data.rndExpenditure === 0 && data.profit > 50000) {
    strategies.push({
      id: 'REL001',
      name: 'R&D Tax Relief',
      description: 'Claim R&D tax relief if undertaking qualifying R&D activities',
      category: 'relief',
      applicable: true,
      potentialSaving: 10000, // Estimated
      implementation: {
        difficulty: 'medium',
        timeRequired: '2-3 weeks',
        cost: 2000, // Professional fees
        steps: [
          'Identify qualifying R&D activities',
          'Calculate qualifying expenditure',
          'Prepare R&D claim',
          'Submit with Corporation Tax return',
        ],
      },
      risks: ['HMRC may challenge claim'],
      compliance: {
        hmrcApproved: true,
        requiresDisclosure: true,
        notes: 'Must meet BEIS guidelines for R&D',
      },
    });
  }

  // Marriage Allowance
  if (profile.entityType === 'sole_trader' || profile.entityType === 'freelancer') {
    strategies.push({
      id: 'REL002',
      name: 'Marriage Allowance',
      description: 'Transfer unused personal allowance to spouse if applicable',
      category: 'relief',
      applicable: true,
      potentialSaving: 252, // £1,260 * 20%
      implementation: {
        difficulty: 'easy',
        timeRequired: '1 hour',
        cost: 0,
        steps: [
          'Check if spouse is basic rate taxpayer',
          'Apply for Marriage Allowance online',
          'Allowance transferred automatically',
        ],
      },
      risks: [],
      compliance: {
        hmrcApproved: true,
        requiresDisclosure: false,
        notes: 'Standard allowance transfer',
      },
    });
  }
}
