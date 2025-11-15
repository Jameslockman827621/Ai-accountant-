import { TenantId } from '@ai-accountant/shared-types';
import { calculateVATFromLedger } from './vatCalculation';

export async function generateVATFiling(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<Record<string, unknown>> {
  const calculation = await calculateVATFromLedger(
    tenantId,
    periodStart,
    periodEnd
  );

  return {
    periodKey: calculation.periodKey,
    vatDueSales: calculation.vatDueSales,
    vatDueAcquisitions: calculation.vatDueAcquisitions,
    totalVatDue: calculation.totalVatDue,
    vatReclaimedCurrPeriod: calculation.vatReclaimedCurrPeriod,
    netVatDue: calculation.netVatDue,
    totalValueSalesExVAT: calculation.totalValueSalesExVAT,
    totalValuePurchasesExVAT: calculation.totalValuePurchasesExVAT,
    totalValueGoodsSuppliedExVAT: calculation.totalValueGoodsSuppliedExVAT,
    totalAcquisitionsExVAT: calculation.totalAcquisitionsExVAT,
  };
}
