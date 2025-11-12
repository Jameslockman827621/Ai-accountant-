import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('rules-engine-service');

export interface VATCalculationResult {
  periodStart: Date;
  periodEnd: Date;
  periodKey: string;
  
  // Output VAT (VAT on sales)
  vatDueSales: number;
  vatDueAcquisitions: number;
  totalVatDue: number;
  
  // Input VAT (VAT on purchases - reclaimable)
  vatReclaimedCurrPeriod: number;
  
  // Net VAT
  netVatDue: number;
  
  // Values
  totalValueSalesExVAT: number;
  totalValuePurchasesExVAT: number;
  totalValueGoodsSuppliedExVAT: number;
  totalAcquisitionsExVAT: number;
  
  // Breakdown by rate
  breakdown: {
    standard: { sales: number; purchases: number; vat: number };
    reduced: { sales: number; purchases: number; vat: number };
    zero: { sales: number; purchases: number; vat: number };
    exempt: { sales: number; purchases: number; vat: number };
  };
  
  // Entry details
  entries: Array<{
    id: string;
    date: Date;
    description: string;
    amount: number;
    vatAmount: number;
    vatRate: number | null;
    type: 'sale' | 'purchase';
  }>;
}

export async function calculateVATForPeriod(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<VATCalculationResult> {
  logger.info('Calculating VAT for period', { tenantId, periodStart, periodEnd });

  // Get all ledger entries in the period with VAT
  const entries = await db.query<{
    id: string;
    transaction_date: Date;
    description: string;
    amount: number;
    tax_amount: number | null;
    tax_rate: number | null;
    entry_type: string;
    account_code: string;
    account_name: string;
  }>(
    `SELECT 
      id, transaction_date, description, amount, 
      tax_amount, tax_rate, entry_type, account_code, account_name
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND tax_amount IS NOT NULL
       AND tax_amount != 0
     ORDER BY transaction_date ASC`,
    [tenantId, periodStart, periodEnd]
  );

  const result: VATCalculationResult = {
    periodStart,
    periodEnd,
    periodKey: generatePeriodKey(periodStart),
    vatDueSales: 0,
    vatDueAcquisitions: 0,
    totalVatDue: 0,
    vatReclaimedCurrPeriod: 0,
    netVatDue: 0,
    totalValueSalesExVAT: 0,
    totalValuePurchasesExVAT: 0,
    totalValueGoodsSuppliedExVAT: 0,
    totalAcquisitionsExVAT: 0,
    breakdown: {
      standard: { sales: 0, purchases: 0, vat: 0 },
      reduced: { sales: 0, purchases: 0, vat: 0 },
      zero: { sales: 0, purchases: 0, vat: 0 },
      exempt: { sales: 0, purchases: 0, vat: 0 },
    },
    entries: [],
  };

  // Categorize accounts: sales vs purchases
  // In production, this would use chart of accounts configuration
  const salesAccountCodes = ['4000', '4100', '4200', '4300']; // Revenue accounts
  const purchaseAccountCodes = ['5000', '5100', '5200', '5300', '6000', '6100', '6200']; // Expense accounts

  for (const entry of entries.rows) {
    const isSale = salesAccountCodes.includes(entry.account_code);
    const isPurchase = purchaseAccountCodes.includes(entry.account_code);
    const type = isSale ? 'sale' : isPurchase ? 'purchase' : null;

    if (!type || !entry.tax_amount || !entry.tax_rate) {
      continue;
    }

    const vatAmount = Number(entry.tax_amount);
    const vatRate = entry.tax_rate;
    const netAmount = Number(entry.amount) - vatAmount;

    // Determine VAT rate category
    let rateCategory: 'standard' | 'reduced' | 'zero' | 'exempt' = 'standard';
    if (vatRate === 0) {
      rateCategory = 'zero';
    } else if (vatRate === null) {
      rateCategory = 'exempt';
    } else if (vatRate < 0.1) {
      rateCategory = 'reduced';
    }

    // Add to breakdown
    if (type === 'sale') {
      result.breakdown[rateCategory].sales += netAmount;
      result.breakdown[rateCategory].vat += vatAmount;
      result.vatDueSales += vatAmount;
      result.totalValueSalesExVAT += netAmount;
    } else {
      result.breakdown[rateCategory].purchases += netAmount;
      result.breakdown[rateCategory].vat += vatAmount;
      result.vatReclaimedCurrPeriod += vatAmount;
      result.totalValuePurchasesExVAT += netAmount;
    }

    result.entries.push({
      id: entry.id,
      date: entry.transaction_date,
      description: entry.description,
      amount: Number(entry.amount),
      vatAmount,
      vatRate,
      type,
    });
  }

  // Calculate totals
  result.totalVatDue = result.vatDueSales + result.vatDueAcquisitions;
  result.netVatDue = result.totalVatDue - result.vatReclaimedCurrPeriod;
  result.totalValueGoodsSuppliedExVAT = result.totalValueSalesExVAT;
  result.totalAcquisitionsExVAT = result.totalValuePurchasesExVAT;

  logger.info('VAT calculation complete', {
    tenantId,
    periodKey: result.periodKey,
    netVatDue: result.netVatDue,
    entriesCount: result.entries.length,
  });

  return result;
}

function generatePeriodKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

export function getVATPeriodBoundaries(
  date: Date,
  filingFrequency: 'monthly' | 'quarterly' = 'quarterly'
): { start: Date; end: Date } {
  if (filingFrequency === 'monthly') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return { start, end };
  } else {
    // Quarterly
    const quarter = Math.floor(date.getMonth() / 3);
    const start = new Date(date.getFullYear(), quarter * 3, 1);
    const end = new Date(date.getFullYear(), (quarter + 1) * 3, 0);
    return { start, end };
  }
}
