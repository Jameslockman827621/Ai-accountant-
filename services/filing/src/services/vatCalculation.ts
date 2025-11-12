import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('filing-service');

export interface VATCalculationResult {
  periodKey: string;
  vatDueSales: number;
  vatDueAcquisitions: number;
  totalVatDue: number;
  vatReclaimedCurrPeriod: number;
  netVatDue: number;
  totalValueSalesExVAT: number;
  totalValuePurchasesExVAT: number;
  totalValueGoodsSuppliedExVAT: number;
  totalAcquisitionsExVAT: number;
  breakdown: {
    sales: Array<{ date: Date; amount: number; vat: number; description: string }>;
    purchases: Array<{ date: Date; amount: number; vat: number; description: string }>;
  };
}

export async function calculateVATFromLedger(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<VATCalculationResult> {
  logger.info('Calculating VAT from ledger entries', { tenantId, periodStart, periodEnd });

  // Get all ledger entries in the period
  const entries = await db.query<{
    id: string;
    entry_type: string;
    amount: number;
    tax_amount: number | null;
    tax_rate: number | null;
    description: string;
    transaction_date: Date;
    account_code: string;
    account_name: string;
  }>(
    `SELECT id, entry_type, amount, tax_amount, tax_rate, description, transaction_date, account_code, account_name
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date >= $2
       AND transaction_date <= $3
       AND tax_amount IS NOT NULL
       AND tax_amount > 0
     ORDER BY transaction_date`,
    [tenantId, periodStart, periodEnd]
  );

  let vatDueSales = 0;
  let vatDueAcquisitions = 0;
  let vatReclaimedCurrPeriod = 0;
  let totalValueSalesExVAT = 0;
  let totalValuePurchasesExVAT = 0;
  let totalValueGoodsSuppliedExVAT = 0;
  let totalAcquisitionsExVAT = 0;

  const salesBreakdown: Array<{ date: Date; amount: number; vat: number; description: string }> = [];
  const purchasesBreakdown: Array<{ date: Date; amount: number; vat: number; description: string }> = [];

  for (const entry of entries.rows) {
    const taxAmount = entry.tax_amount || 0;
    const amountExVAT = entry.amount - taxAmount;

    // Determine if this is a sale (credit) or purchase (debit)
    if (entry.entry_type === 'credit') {
      // Sales/Income - VAT is output VAT (VAT due)
      vatDueSales += taxAmount;
      totalValueSalesExVAT += amountExVAT;

      // Check if it's a supply to another EU country
      if (entry.account_code.startsWith('4') || entry.account_name.toLowerCase().includes('eu')) {
        totalValueGoodsSuppliedExVAT += amountExVAT;
      }

      salesBreakdown.push({
        date: entry.transaction_date,
        amount: amountExVAT,
        vat: taxAmount,
        description: entry.description,
      });
    } else if (entry.entry_type === 'debit') {
      // Purchases/Expenses - VAT is input VAT (VAT reclaimable)
      vatReclaimedCurrPeriod += taxAmount;
      totalValuePurchasesExVAT += amountExVAT;

      // Check if it's an acquisition from EU
      if (entry.account_code.startsWith('2') || entry.account_name.toLowerCase().includes('eu')) {
        totalAcquisitionsExVAT += amountExVAT;
        vatDueAcquisitions += taxAmount;
      }

      purchasesBreakdown.push({
        date: entry.transaction_date,
        amount: amountExVAT,
        vat: taxAmount,
        description: entry.description,
      });
    }
  }

  const totalVatDue = vatDueSales + vatDueAcquisitions;
  const netVatDue = totalVatDue - vatReclaimedCurrPeriod;

  // Generate period key (YYYYMM format)
  const periodKey = `${periodEnd.getFullYear()}${String(periodEnd.getMonth() + 1).padStart(2, '0')}`;

  logger.info('VAT calculation completed', {
    tenantId,
    periodKey,
    netVatDue,
    totalVatDue,
    vatReclaimedCurrPeriod,
  });

  return {
    periodKey,
    vatDueSales: Math.round(vatDueSales * 100) / 100,
    vatDueAcquisitions: Math.round(vatDueAcquisitions * 100) / 100,
    totalVatDue: Math.round(totalVatDue * 100) / 100,
    vatReclaimedCurrPeriod: Math.round(vatReclaimedCurrPeriod * 100) / 100,
    netVatDue: Math.round(netVatDue * 100) / 100,
    totalValueSalesExVAT: Math.round(totalValueSalesExVAT * 100) / 100,
    totalValuePurchasesExVAT: Math.round(totalValuePurchasesExVAT * 100) / 100,
    totalValueGoodsSuppliedExVAT: Math.round(totalValueGoodsSuppliedExVAT * 100) / 100,
    totalAcquisitionsExVAT: Math.round(totalAcquisitionsExVAT * 100) / 100,
    breakdown: {
      sales: salesBreakdown,
      purchases: purchasesBreakdown,
    },
  };
}
