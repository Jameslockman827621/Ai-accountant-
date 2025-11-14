import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { FilingType, FilingStatus, TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('analytics-service');

export interface UpcomingDeadline {
  type: FilingType | 'paye';
  description: string;
  dueDate: string;
  amount: number;
  daysUntilDue: number;
  status: FilingStatus | 'scheduled';
}

export interface DashboardStats {
  period: {
    start: string;
    end: string;
  };
  revenue: number;
  expenses: number;
  profit: number;
  vat: {
    net: number;
    output: number;
    input: number;
  };
  upcomingDeadlines: UpcomingDeadline[];
}

interface DashboardOptions {
  periodStart?: Date;
  periodEnd?: Date;
}

export async function getDashboardStats(
  tenantId: TenantId,
  options?: DashboardOptions
): Promise<DashboardStats> {
  const now = options?.periodEnd ?? new Date();
  const defaultPeriodStart = startOfQuarter(now);
  const periodStart = options?.periodStart ?? defaultPeriodStart;
  const periodEnd = options?.periodEnd ?? now;

  logger.info('Generating dashboard stats', { tenantId, periodStart, periodEnd });

  const [revenueRow, expenseRow] = await Promise.all([
    db.query<{ total: string | number | null }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM ledger_entries
       WHERE tenant_id = $1
         AND transaction_date BETWEEN $2 AND $3
         AND entry_type = 'credit'
         AND account_code LIKE '4%'`,
      [tenantId, periodStart, periodEnd]
    ),
    db.query<{ total: string | number | null }>(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM ledger_entries
       WHERE tenant_id = $1
         AND transaction_date BETWEEN $2 AND $3
         AND entry_type = 'debit'
         AND (account_code LIKE '5%' OR account_code LIKE '6%')`,
      [tenantId, periodStart, periodEnd]
    ),
  ]);

  const revenue = roundCurrency(parseDbNumber(revenueRow.rows[0]?.total));
  const expenses = roundCurrency(parseDbNumber(expenseRow.rows[0]?.total));

  const vatResult = await db.query<{
    output_vat: string | number | null;
    input_vat: string | number | null;
  }>(
    `SELECT
        COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN tax_amount ELSE 0 END), 0) AS output_vat,
        COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN tax_amount ELSE 0 END), 0) AS input_vat
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
       AND tax_amount IS NOT NULL`,
    [tenantId, periodStart, periodEnd]
  );

  const outputVat = roundCurrency(parseDbNumber(vatResult.rows[0]?.output_vat));
  const inputVat = roundCurrency(parseDbNumber(vatResult.rows[0]?.input_vat));
  const netVat = roundCurrency(outputVat - inputVat);

  const latestFilings = await db.query<{
    filing_type: FilingType;
    filing_data: Record<string, unknown> | null;
  }>(
    `SELECT DISTINCT ON (filing_type)
        filing_type,
        filing_data
     FROM filings
     WHERE tenant_id = $1
     ORDER BY filing_type, period_end DESC`,
    [tenantId]
  );

  const latestAmounts = new Map<FilingType, number>();
  for (const row of latestFilings.rows) {
    latestAmounts.set(row.filing_type, extractAmount(row.filing_type, row.filing_data));
  }

  const upcomingDeadlines = buildUpcomingDeadlines(now, latestAmounts);

  return {
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
    },
    revenue,
    expenses,
    profit: roundCurrency(revenue - expenses),
    vat: {
      net: netVat,
      output: outputVat,
      input: inputVat,
    },
    upcomingDeadlines,
  };
}

function parseDbNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function startOfQuarter(date: Date): Date {
  const quarter = Math.floor(date.getMonth() / 3);
  return new Date(date.getFullYear(), quarter * 3, 1);
}

function endOfQuarter(date: Date): Date {
  const start = startOfQuarter(date);
  return new Date(start.getFullYear(), start.getMonth() + 3, 0);
}

function buildUpcomingDeadlines(
  referenceDate: Date,
  latestAmounts: Map<FilingType, number>
): UpcomingDeadline[] {
  const deadlines: UpcomingDeadline[] = [];
  const today = new Date(referenceDate);

  // VAT Return (next quarter)
  const currentQuarterEnd = endOfQuarter(today);
  const vatDueDate = addDays(addMonths(currentQuarterEnd, 1), 7);
  deadlines.push({
    type: FilingType.VAT,
    description: 'VAT Return',
    dueDate: vatDueDate.toISOString(),
    amount: latestAmounts.get(FilingType.VAT) ?? 0,
    daysUntilDue: daysBetween(today, vatDueDate),
    status: 'scheduled',
  });

  // PAYE (monthly)
  const payePeriodEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const payeDueDate = new Date(today.getFullYear(), today.getMonth(), 19);
  deadlines.push({
    type: FilingType.PAYE,
    description: 'PAYE Payment',
    dueDate: payeDueDate.toISOString(),
    amount: latestAmounts.get(FilingType.PAYE) ?? 0,
    daysUntilDue: daysBetween(today, payeDueDate),
    status: 'scheduled',
  });

  // Corporation Tax (assume year end 31 March)
  const corpYearEnd = getFiscalYearEnd(today);
  const corpDueDate = new Date(corpYearEnd);
  corpDueDate.setMonth(corpDueDate.getMonth() + 9);
  corpDueDate.setDate(1);
  deadlines.push({
    type: FilingType.CORPORATION_TAX,
    description: 'Corporation Tax Return',
    dueDate: corpDueDate.toISOString(),
    amount: latestAmounts.get(FilingType.CORPORATION_TAX) ?? 0,
    daysUntilDue: daysBetween(today, corpDueDate),
    status: 'scheduled',
  });

  // Income Tax (Self Assessment) - due 31 January following tax year
  const taxYearEnd = getTaxYearEnd(today);
  const selfAssessmentDue = new Date(taxYearEnd.getFullYear(), 0, 31);
  deadlines.push({
    type: FilingType.INCOME_TAX,
    description: 'Self Assessment Tax Return',
    dueDate: selfAssessmentDue.toISOString(),
    amount: latestAmounts.get(FilingType.INCOME_TAX) ?? 0,
    daysUntilDue: daysBetween(today, selfAssessmentDue),
    status: 'scheduled',
  });

  return deadlines
    .filter(deadline => deadline.daysUntilDue >= 0 && deadline.daysUntilDue <= 120)
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}

function extractAmount(
  filingType: FilingType,
  filingData: Record<string, unknown> | null
): number {
  if (!filingData) {
    return 0;
  }

  switch (filingType) {
    case FilingType.VAT:
      return roundCurrency(
        parseDbNumber(
          (filingData.netVatDue as number | string | null) ??
          (filingData.totalVatDue as number | string | null) ??
          0
        )
      );
    case FilingType.PAYE:
      return roundCurrency(
        parseDbNumber(
          (filingData.totalPAYE as number | string | null) ??
          (filingData.incomeTax as number | string | null) ??
          0
        )
      );
    case FilingType.CORPORATION_TAX:
      return roundCurrency(
        parseDbNumber((filingData.corporationTax as number | string | null) ?? 0)
      );
    case FilingType.INCOME_TAX:
      return roundCurrency(
        parseDbNumber((filingData.taxDue as number | string | null) ?? 0)
      );
    default:
      return 0;
  }
}

function addMonths(date: Date, months: number): Date {
  const clone = new Date(date);
  clone.setMonth(clone.getMonth() + months);
  return clone;
}

function addDays(date: Date, days: number): Date {
  const clone = new Date(date);
  clone.setDate(clone.getDate() + days);
  return clone;
}

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

function getFiscalYearEnd(reference: Date): Date {
  const fiscalYearEnd = new Date(reference.getFullYear(), 2, 31); // 31 March
  if (reference > fiscalYearEnd) {
    fiscalYearEnd.setFullYear(fiscalYearEnd.getFullYear() + 1);
  }
  return fiscalYearEnd;
}

function getTaxYearEnd(reference: Date): Date {
  const year = reference.getMonth() >= 3 ? reference.getFullYear() + 1 : reference.getFullYear();
  return new Date(year, 3, 5); // UK tax year ends 5 April
}
