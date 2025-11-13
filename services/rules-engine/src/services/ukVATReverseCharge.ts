import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { db } from '@ai-accountant/database';

const logger = createLogger('rules-engine-service');

export interface ReverseChargeTransaction {
  id: string;
  date: Date;
  supplierVATNumber: string;
  supplierCountry: string;
  amountExVAT: number;
  vatAmount: number;
  description: string;
  serviceType: 'B2B' | 'B2C';
}

export interface ReverseChargeCalculation {
  periodStart: Date;
  periodEnd: Date;
  transactions: ReverseChargeTransaction[];
  totalOutputVAT: number; // VAT to be paid (output)
  totalInputVAT: number; // VAT to be reclaimed (input)
  netVATDue: number; // Usually zero for reverse charge
  requiresDisclosure: boolean;
  disclosureDetails: {
    totalValue: number;
    transactionCount: number;
    countries: Record<string, number>;
  };
}

/**
 * Comprehensive VAT Reverse Charge mechanism
 * Applies to B2B services from EU suppliers and certain goods/services
 */
export async function calculateVATReverseCharge(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<ReverseChargeCalculation> {
  logger.info('Calculating VAT reverse charge', { tenantId, periodStart, periodEnd });

  // Get all transactions that might be subject to reverse charge
  const transactions = await db.query<{
    id: string;
    date: Date;
    amount: number;
    description: string;
    extracted_data: unknown;
    document_id: string;
  }>(
    `SELECT 
       le.id,
       le.transaction_date as date,
       le.amount,
       le.description,
       d.extracted_data,
       le.document_id
     FROM ledger_entries le
     LEFT JOIN documents d ON d.id = le.document_id
     WHERE le.tenant_id = $1
       AND le.transaction_date BETWEEN $2 AND $3
       AND (
         le.description ILIKE '%reverse charge%'
         OR le.description ILIKE '%EU%'
         OR le.description ILIKE '%VAT%'
         OR d.extracted_data->>'supplierCountry' IS NOT NULL
         OR d.extracted_data->>'supplierVATNumber' IS NOT NULL
       )
     ORDER BY le.transaction_date`,
    [tenantId, periodStart, periodEnd]
  );

  const reverseChargeTransactions: ReverseChargeTransaction[] = [];
  let totalOutputVAT = 0;
  let totalInputVAT = 0;
  const countries: Record<string, number> = {};

  for (const row of transactions.rows) {
    const extractedData = row.extracted_data as Record<string, unknown> | null;
    const supplierCountry = (extractedData?.supplierCountry as string) || 'GB';
    const supplierVATNumber = (extractedData?.supplierVATNumber as string) || '';

    // Determine if reverse charge applies
    const isReverseCharge = determineReverseChargeApplicability(
      supplierCountry,
      supplierVATNumber,
      row.description,
      extractedData
    );

    if (isReverseCharge) {
      // For reverse charge, customer accounts for VAT
      // Output VAT = Input VAT (net effect is usually zero)
      const amountExVAT = row.amount / 1.20; // Assuming 20% VAT
      const vatAmount = row.amount - amountExVAT;

      totalOutputVAT += vatAmount;
      totalInputVAT += vatAmount; // Can be reclaimed

      countries[supplierCountry] = (countries[supplierCountry] || 0) + amountExVAT;

      reverseChargeTransactions.push({
        id: row.id,
        date: row.date,
        supplierVATNumber,
        supplierCountry,
        amountExVAT,
        vatAmount,
        description: row.description,
        serviceType: 'B2B', // Reverse charge typically applies to B2B
      });
    }
  }

  const netVATDue = totalOutputVAT - totalInputVAT; // Should be zero for pure reverse charge
  const requiresDisclosure = reverseChargeTransactions.length > 0;

  return {
    periodStart,
    periodEnd,
    transactions: reverseChargeTransactions,
    totalOutputVAT,
    totalInputVAT,
    netVATDue,
    requiresDisclosure,
    disclosureDetails: {
      totalValue: reverseChargeTransactions.reduce((sum, t) => sum + t.amountExVAT, 0),
      transactionCount: reverseChargeTransactions.length,
      countries,
    },
  };
}

function determineReverseChargeApplicability(
  supplierCountry: string,
  supplierVATNumber: string,
  description: string,
  extractedData: Record<string, unknown> | null
): boolean {
  const lowerDesc = description.toLowerCase();

  // Reverse charge applies to:
  // 1. B2B services from EU suppliers (post-Brexit, this changed)
  // 2. Certain goods/services specified by HMRC
  // 3. Construction services (CIS)
  // 4. Mobile phones, computer chips, etc.

  // EU supplier (post-Brexit, reverse charge may still apply in some cases)
  if (supplierCountry && supplierCountry !== 'GB' && supplierVATNumber) {
    // Check if it's a service (B2B)
    const isService = extractedData?.serviceType === 'B2B' ||
      lowerDesc.includes('service') ||
      lowerDesc.includes('consulting') ||
      lowerDesc.includes('software') ||
      lowerDesc.includes('digital');

    if (isService) {
      return true;
    }
  }

  // Construction Industry Scheme
  if (lowerDesc.includes('construction') || lowerDesc.includes('building') || lowerDesc.includes('cis')) {
    return true;
  }

  // Specific goods subject to reverse charge
  const reverseChargeGoods = [
    'mobile phone',
    'computer chip',
    'wholesale',
    'emissions allowance',
  ];

  for (const good of reverseChargeGoods) {
    if (lowerDesc.includes(good)) {
      return true;
    }
  }

  // Explicit reverse charge indicator
  if (lowerDesc.includes('reverse charge') || lowerDesc.includes('vat reverse')) {
    return true;
  }

  return false;
}

/**
 * Generate reverse charge disclosure for VAT return
 */
export function generateReverseChargeDisclosure(
  calculation: ReverseChargeCalculation
): Record<string, unknown> {
  return {
    box1: calculation.totalOutputVAT, // Output VAT on reverse charge supplies
    box4: calculation.totalInputVAT, // Input VAT on reverse charge supplies
    box7: calculation.disclosureDetails.totalValue, // Total value of reverse charge supplies
    box8: calculation.disclosureDetails.transactionCount, // Number of reverse charge transactions
    box9: Object.keys(calculation.disclosureDetails.countries).length, // Number of countries
    countries: calculation.disclosureDetails.countries,
    transactions: calculation.transactions.map(t => ({
      date: t.date,
      supplierVAT: t.supplierVATNumber,
      country: t.supplierCountry,
      amount: t.amountExVAT,
      vat: t.vatAmount,
    })),
  };
}
