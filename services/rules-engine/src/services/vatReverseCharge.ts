import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('rules-engine-service');

export interface ReverseChargeTransaction {
  date: Date;
  amount: number;
  supplierVATNumber: string;
  supplierCountry: string;
  description: string;
  vatRate: number;
}

export interface ReverseChargeCalculation {
  periodStart: Date;
  periodEnd: Date;
  transactions: ReverseChargeTransaction[];
  totalOutputVAT: number;
  totalInputVAT: number;
  netVATDue: number;
  box1: number; // Output VAT on reverse charge supplies
  box4: number; // Input VAT on reverse charge supplies
  box7: number; // Total value of reverse charge supplies
}

/**
 * Calculate VAT reverse charge for services received from EU suppliers
 * UK businesses must account for VAT on services received from EU suppliers
 */
export async function calculateVATReverseCharge(
  tenantId: TenantId,
  transactions: ReverseChargeTransaction[],
  periodStart: Date,
  periodEnd: Date
): Promise<ReverseChargeCalculation> {
  logger.info('Calculating VAT reverse charge', { tenantId, transactionCount: transactions.length });

  const periodTransactions = transactions.filter(
    t => t.date >= periodStart && t.date <= periodEnd && t.supplierCountry !== 'GB'
  );

  let totalOutputVAT = 0;
  let totalInputVAT = 0;
  let totalValue = 0;

  for (const transaction of periodTransactions) {
    const amountExVAT = transaction.amount / (1 + transaction.vatRate);
    const vatAmount = transaction.amount - amountExVAT;

    // Reverse charge: output VAT (box 1) and input VAT (box 4) are the same
    totalOutputVAT += vatAmount;
    totalInputVAT += vatAmount;
    totalValue += amountExVAT;
  }

  const netVATDue = totalOutputVAT - totalInputVAT; // Should be 0 for reverse charge

  return {
    periodStart,
    periodEnd,
    transactions: periodTransactions,
    totalOutputVAT,
    totalInputVAT,
    netVATDue,
    box1: totalOutputVAT,
    box4: totalInputVAT,
    box7: totalValue,
  };
}

/**
 * Check if a transaction should be subject to reverse charge
 */
export function shouldApplyReverseCharge(
  supplierCountry: string,
  supplierVATNumber: string,
  serviceType: string
): boolean {
  // Reverse charge applies to:
  // 1. Services from EU suppliers (non-UK)
  // 2. B2B transactions
  // 3. Most services (exceptions exist for certain services)

  if (supplierCountry === 'GB' || !supplierVATNumber) {
    return false;
  }

  // EU countries
  const euCountries = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
  ];

  if (!euCountries.includes(supplierCountry)) {
    return false;
  }

  // Exceptions: certain services are not subject to reverse charge
  const excludedServices = [
    'land',
    'property',
    'transport',
    'restaurant',
    'catering',
  ];

  const lowerServiceType = serviceType.toLowerCase();
  if (excludedServices.some(excluded => lowerServiceType.includes(excluded))) {
    return false;
  }

  return true;
}
