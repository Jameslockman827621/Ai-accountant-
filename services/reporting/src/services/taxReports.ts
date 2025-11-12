import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { calculateVATFromLedger } from '../../filing/src/services/vatCalculation';
import { calculatePAYE } from '../../rules-engine/src/services/payeCalculation';
import { calculateCorporationTax } from '../../rules-engine/src/services/corporationTax';

const logger = createLogger('reporting-service');

export interface TaxReport {
  period: { start: Date; end: Date };
  vat: {
    vatDueSales: number;
    vatReclaimedCurrPeriod: number;
    netVatDue: number;
    breakdown: Array<{ period: string; amount: number }>;
  };
  paye: {
    grossPay: number;
    employeeNI: number;
    employerNI: number;
    incomeTax: number;
    totalCost: number;
  };
  corporationTax: {
    taxableProfit: number;
    corporationTax: number;
    rate: number;
  };
  totalTaxLiability: number;
  summary: {
    taxType: string;
    amount: number;
    dueDate: Date | null;
  }[];
}

export async function generateTaxReport(
  tenantId: TenantId,
  startDate: Date,
  endDate: Date
): Promise<TaxReport> {
  logger.info('Generating tax report', { tenantId, startDate, endDate });

  // Calculate VAT
  const vatCalculation = await calculateVATFromLedger(tenantId, startDate, endDate);

  // Calculate PAYE (for the period)
  const payeCalculation = await calculatePAYE(tenantId, startDate, endDate);

  // Calculate Corporation Tax
  const ctCalculation = await calculateCorporationTax(tenantId, startDate, endDate);

  // Get VAT breakdown by period (last 4 periods)
  const vatBreakdown = await db.query<{
    period_key: string;
    net_vat_due: number;
  }>(
    `SELECT 
       TO_CHAR(period_end, 'YYYY-MM') as period_key,
       (filing_data->>'netVatDue')::numeric as net_vat_due
     FROM filings
     WHERE tenant_id = $1
       AND filing_type = 'vat'
       AND period_end >= $2
       AND period_end <= $3
     ORDER BY period_end DESC
     LIMIT 4`,
    [tenantId, new Date(startDate.getFullYear(), startDate.getMonth() - 3, 1), endDate]
  );

  const totalTaxLiability = vatCalculation.netVatDue + 
                            payeCalculation.incomeTax + 
                            payeCalculation.employeeNI + 
                            payeCalculation.employerNI + 
                            ctCalculation.corporationTax;

  // Calculate due dates (simplified)
  const vatDueDate = new Date(endDate);
  vatDueDate.setMonth(vatDueDate.getMonth() + 1);
  vatDueDate.setDate(7); // VAT due 7th of month after period end

  const payeDueDate = new Date(endDate);
  payeDueDate.setMonth(payeDueDate.getMonth() + 1);
  payeDueDate.setDate(22); // PAYE due 22nd of month after period end

  const ctDueDate = new Date(endDate.getFullYear() + 1, 8, 1); // CT due 9 months after year end

  return {
    period: { start: startDate, end: endDate },
    vat: {
      vatDueSales: vatCalculation.vatDueSales,
      vatReclaimedCurrPeriod: vatCalculation.vatReclaimedCurrPeriod,
      netVatDue: vatCalculation.netVatDue,
      breakdown: vatBreakdown.rows.map(row => ({
        period: row.period_key,
        amount: typeof row.net_vat_due === 'number' ? row.net_vat_due : parseFloat(String(row.net_vat_due || '0')),
      })),
    },
    paye: {
      grossPay: payeCalculation.grossPay,
      employeeNI: payeCalculation.employeeNI,
      employerNI: payeCalculation.employerNI,
      incomeTax: payeCalculation.incomeTax,
      totalCost: payeCalculation.totalCost,
    },
    corporationTax: {
      taxableProfit: ctCalculation.taxableProfit,
      corporationTax: ctCalculation.corporationTax,
      rate: ctCalculation.corporationTaxRate,
    },
    totalTaxLiability: Math.round(totalTaxLiability * 100) / 100,
    summary: [
      {
        taxType: 'VAT',
        amount: vatCalculation.netVatDue,
        dueDate: vatDueDate,
      },
      {
        taxType: 'PAYE',
        amount: payeCalculation.incomeTax + payeCalculation.employeeNI + payeCalculation.employerNI,
        dueDate: payeDueDate,
      },
      {
        taxType: 'Corporation Tax',
        amount: ctCalculation.corporationTax,
        dueDate: ctDueDate,
      },
    ],
  };
}
