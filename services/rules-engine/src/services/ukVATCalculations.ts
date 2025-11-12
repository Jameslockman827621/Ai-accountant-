import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getEntityTaxProfile } from './ukTaxEntities';

const logger = createLogger('rules-engine-service');

export interface VATTransaction {
  date: Date;
  amount: number;
  vatRate: 'standard' | 'reduced' | 'zero' | 'exempt';
  isInput: boolean; // true for purchases, false for sales
  description: string;
}

export interface VATCalculationResult {
  periodStart: Date;
  periodEnd: Date;
  standardRate: {
    sales: number;
    purchases: number;
    outputVAT: number;
    inputVAT: number;
  };
  reducedRate: {
    sales: number;
    purchases: number;
    outputVAT: number;
    inputVAT: number;
  };
  zeroRate: {
    sales: number;
    purchases: number;
  };
  exempt: {
    sales: number;
    purchases: number;
  };
  totalOutputVAT: number;
  totalInputVAT: number;
  netVATDue: number;
  flatRateScheme: {
    applicable: boolean;
    rate: number;
    turnover: number;
    vatDue: number;
    savings: number;
  };
  registrationRequired: boolean;
  deregistrationPossible: boolean;
}

export async function calculateVAT(
  tenantId: TenantId,
  transactions: VATTransaction[],
  periodStart: Date,
  periodEnd: Date,
  useFlatRateScheme: boolean = false,
  flatRateCategory: string = 'general'
): Promise<VATCalculationResult> {
  const profile = await getEntityTaxProfile(tenantId);
  const { vat } = profile;

  // Filter transactions for period
  const periodTransactions = transactions.filter(
    t => t.date >= periodStart && t.date <= periodEnd
  );

  // Calculate by rate
  const standardRate = {
    sales: 0,
    purchases: 0,
    outputVAT: 0,
    inputVAT: 0,
  };

  const reducedRate = {
    sales: 0,
    purchases: 0,
    outputVAT: 0,
    inputVAT: 0,
  };

  const zeroRate = {
    sales: 0,
    purchases: 0,
  };

  const exempt = {
    sales: 0,
    purchases: 0,
  };

  for (const transaction of periodTransactions) {
    const amountExVAT = transaction.amount / (1 + (transaction.vatRate === 'standard' ? vat.standardRate : 
      transaction.vatRate === 'reduced' ? vat.reducedRate : 0));

    if (transaction.vatRate === 'standard') {
      if (transaction.isInput) {
        standardRate.purchases += amountExVAT;
        standardRate.inputVAT += transaction.amount - amountExVAT;
      } else {
        standardRate.sales += amountExVAT;
        standardRate.outputVAT += transaction.amount - amountExVAT;
      }
    } else if (transaction.vatRate === 'reduced') {
      if (transaction.isInput) {
        reducedRate.purchases += amountExVAT;
        reducedRate.inputVAT += transaction.amount - amountExVAT;
      } else {
        reducedRate.sales += amountExVAT;
        reducedRate.outputVAT += transaction.amount - amountExVAT;
      }
    } else if (transaction.vatRate === 'zero') {
      if (transaction.isInput) {
        zeroRate.purchases += amountExVAT;
      } else {
        zeroRate.sales += amountExVAT;
      }
    } else if (transaction.vatRate === 'exempt') {
      if (transaction.isInput) {
        exempt.purchases += amountExVAT;
      } else {
        exempt.sales += amountExVAT;
      }
    }
  }

  const totalOutputVAT = standardRate.outputVAT + reducedRate.outputVAT;
  const totalInputVAT = standardRate.inputVAT + reducedRate.inputVAT;
  const netVATDue = totalOutputVAT - totalInputVAT;

  // Flat Rate Scheme calculation
  const totalTurnover = standardRate.sales + reducedRate.sales + zeroRate.sales + exempt.sales;
  const flatRatePercentage = vat.flatRatePercentages[flatRateCategory] || vat.flatRatePercentages['general'] || 16.5;
  const flatRateVATDue = totalTurnover * (flatRatePercentage / 100);
  const flatRateSavings = netVATDue - flatRateVATDue;

  // Registration checks
  const rolling12MonthTurnover = calculateRolling12MonthTurnover(transactions, periodEnd);
  const registrationRequired = rolling12MonthTurnover >= vat.registrationThreshold;
  const deregistrationPossible = rolling12MonthTurnover < vat.deregistrationThreshold;

  return {
    periodStart,
    periodEnd,
    standardRate,
    reducedRate,
    zeroRate,
    exempt,
    totalOutputVAT,
    totalInputVAT,
    netVATDue: useFlatRateScheme && vat.flatRateScheme ? flatRateVATDue : netVATDue,
    flatRateScheme: {
      applicable: vat.flatRateScheme && useFlatRateScheme,
      rate: flatRatePercentage,
      turnover: totalTurnover,
      vatDue: flatRateVATDue,
      savings: flatRateSavings,
    },
    registrationRequired,
    deregistrationPossible,
  };
}

function calculateRolling12MonthTurnover(transactions: VATTransaction[], asOfDate: Date): number {
  const twelveMonthsAgo = new Date(asOfDate);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  return transactions
    .filter(t => t.date >= twelveMonthsAgo && t.date <= asOfDate && !t.isInput)
    .reduce((sum, t) => {
      // Calculate amount excluding VAT for turnover
      const vatRate = t.vatRate === 'standard' ? 0.20 : t.vatRate === 'reduced' ? 0.05 : 0;
      return sum + (t.amount / (1 + vatRate));
    }, 0);
}

// VAT rate determination based on goods/services
export function determineVATRate(
  category: string,
  description: string,
  isCharity: boolean = false
): 'standard' | 'reduced' | 'zero' | 'exempt' {
  const lowerCategory = category.toLowerCase();
  const lowerDesc = description.toLowerCase();

  // Zero-rated items
  if (lowerCategory.includes('book') || lowerCategory.includes('newspaper') ||
      lowerCategory.includes('magazine') || lowerCategory.includes('children') ||
      lowerCategory.includes('food') && !lowerDesc.includes('hot') ||
      lowerCategory.includes('medicine') || lowerCategory.includes('prescription')) {
    return 'zero';
  }

  // Reduced rate (5%)
  if (lowerCategory.includes('energy') || lowerCategory.includes('fuel') ||
      lowerCategory.includes('heating') || lowerCategory.includes('insulation') ||
      lowerCategory.includes('mobility') || lowerCategory.includes('sanitary')) {
    return 'reduced';
  }

  // Exempt items
  if (lowerCategory.includes('education') || lowerCategory.includes('training') ||
      lowerCategory.includes('healthcare') || lowerCategory.includes('medical') ||
      lowerCategory.includes('insurance') || lowerCategory.includes('financial') ||
      lowerCategory.includes('postal') || lowerCategory.includes('betting') ||
      lowerCategory.includes('lottery') || (isCharity && lowerCategory.includes('charity'))) {
    return 'exempt';
  }

  // Standard rate (20%) - default
  return 'standard';
}
