import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getEntityTaxProfile } from './ukTaxEntities';

const logger = createLogger('rules-engine-service');

export interface TaxRelief {
  type: string;
  name: string;
  description: string;
  applicable: boolean;
  amount: number;
  rate: number;
  maxAmount: number;
  used: number;
  remaining: number;
  taxSaving: number;
}

export interface RAndDRelief {
  type: 'sme' | 'large';
  qualifyingExpenditure: number;
  rate: number;
  reliefAmount: number;
  taxSaving: number;
  categories: {
    staff: number;
    subcontractors: number;
    consumables: number;
    software: number;
    utilities: number;
    other: number;
  };
}

export interface InvestmentRelief {
  type: 'eis' | 'seis' | 'vct';
  investmentAmount: number;
  rate: number;
  reliefAmount: number;
  taxSaving: number;
  maxInvestment: number;
  qualifying: boolean;
}

export interface AnnualInvestmentAllowance {
  qualifyingExpenditure: number;
  allowance: number;
  used: number;
  remaining: number;
  taxSaving: number;
}

export async function calculateRAndDRelief(
  tenantId: TenantId,
  qualifyingExpenditure: number,
  categories: {
    staff?: number;
    subcontractors?: number;
    consumables?: number;
    software?: number;
    utilities?: number;
    other?: number;
  },
  isSME: boolean = true
): Promise<RAndDRelief> {
  const profile = await getEntityTaxProfile(tenantId);
  const rate = isSME ? profile.reliefs.rndSmeRate : profile.reliefs.rndLargeRate;

  // R&D relief calculation
  // SME: 186% of qualifying expenditure (86% additional deduction)
  // Large: 20% credit
  const reliefAmount = isSME 
    ? qualifyingExpenditure * (rate - 1) // Additional deduction
    : qualifyingExpenditure * rate; // Credit

  // Tax saving depends on corporation tax rate
  const corporationTaxRate = profile.corporationTax.applicable 
    ? profile.corporationTax.smallProfitsRate 
    : 0.19;
  
  const taxSaving = isSME
    ? reliefAmount * corporationTaxRate
    : reliefAmount; // Credit is direct tax saving

  return {
    type: isSME ? 'sme' : 'large',
    qualifyingExpenditure,
    rate,
    reliefAmount,
    taxSaving,
    categories: {
      staff: categories.staff || 0,
      subcontractors: categories.subcontractors || 0,
      consumables: categories.consumables || 0,
      software: categories.software || 0,
      utilities: categories.utilities || 0,
      other: categories.other || 0,
    },
  };
}

export async function calculateInvestmentRelief(
  tenantId: TenantId,
  type: 'eis' | 'seis' | 'vct',
  investmentAmount: number,
  isQualifying: boolean = true
): Promise<InvestmentRelief> {
  const profile = await getEntityTaxProfile(tenantId);

  let rate = 0;
  let maxInvestment = 0;

  if (type === 'eis') {
    rate = profile.reliefs.eisRate;
    maxInvestment = profile.reliefs.eisMaxInvestment;
  } else if (type === 'seis') {
    rate = profile.reliefs.seisRate;
    maxInvestment = profile.reliefs.seisMaxInvestment;
  } else if (type === 'vct') {
    rate = profile.reliefs.vctRate;
    maxInvestment = 200000; // VCT annual limit
  }

  const eligibleAmount = Math.min(investmentAmount, maxInvestment);
  const reliefAmount = eligibleAmount * rate;
  
  // Tax saving is the relief amount (income tax relief)
  const taxSaving = isQualifying ? reliefAmount : 0;

  return {
    type,
    investmentAmount,
    rate,
    reliefAmount: isQualifying ? reliefAmount : 0,
    taxSaving,
    maxInvestment,
    qualifying: isQualifying && investmentAmount <= maxInvestment,
  };
}

export async function calculateAnnualInvestmentAllowance(
  tenantId: TenantId,
  qualifyingExpenditure: number,
  alreadyUsed: number = 0
): Promise<AnnualInvestmentAllowance> {
  const profile = await getEntityTaxProfile(tenantId);
  const allowance = profile.reliefs.annualInvestmentAllowance;

  const used = Math.min(qualifyingExpenditure, allowance - alreadyUsed);
  const remaining = Math.max(0, allowance - alreadyUsed - used);

  // Tax saving depends on corporation tax rate
  const corporationTaxRate = profile.corporationTax.applicable
    ? profile.corporationTax.smallProfitsRate
    : 0.19;

  const taxSaving = used * corporationTaxRate;

  return {
    qualifyingExpenditure,
    allowance,
    used,
    remaining,
    taxSaving,
  };
}

export async function calculateAllReliefs(
  tenantId: TenantId,
  data: {
    rndExpenditure?: number;
    rndCategories?: Record<string, number>;
    eisInvestment?: number;
    seisInvestment?: number;
    vctInvestment?: number;
    aiaExpenditure?: number;
    aiaUsed?: number;
  }
): Promise<{
  rnd?: RAndDRelief;
  eis?: InvestmentRelief;
  seis?: InvestmentRelief;
  vct?: InvestmentRelief;
  aia?: AnnualInvestmentAllowance;
  totalTaxSaving: number;
}> {
  const reliefs: {
    rnd?: RAndDRelief;
    eis?: InvestmentRelief;
    seis?: InvestmentRelief;
    vct?: InvestmentRelief;
    aia?: AnnualInvestmentAllowance;
  } = {};

  if (data.rndExpenditure && data.rndExpenditure > 0) {
    reliefs.rnd = await calculateRAndDRelief(
      tenantId,
      data.rndExpenditure,
      data.rndCategories || {},
      true // Assume SME
    );
  }

  if (data.eisInvestment && data.eisInvestment > 0) {
    reliefs.eis = await calculateInvestmentRelief(tenantId, 'eis', data.eisInvestment);
  }

  if (data.seisInvestment && data.seisInvestment > 0) {
    reliefs.seis = await calculateInvestmentRelief(tenantId, 'seis', data.seisInvestment);
  }

  if (data.vctInvestment && data.vctInvestment > 0) {
    reliefs.vct = await calculateInvestmentRelief(tenantId, 'vct', data.vctInvestment);
  }

  if (data.aiaExpenditure && data.aiaExpenditure > 0) {
    reliefs.aia = await calculateAnnualInvestmentAllowance(
      tenantId,
      data.aiaExpenditure,
      data.aiaUsed || 0
    );
  }

  const totalTaxSaving = 
    (reliefs.rnd?.taxSaving || 0) +
    (reliefs.eis?.taxSaving || 0) +
    (reliefs.seis?.taxSaving || 0) +
    (reliefs.vct?.taxSaving || 0) +
    (reliefs.aia?.taxSaving || 0);

  return {
    ...reliefs,
    totalTaxSaving,
  };
}
