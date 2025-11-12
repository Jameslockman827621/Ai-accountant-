import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { getEntityTaxProfile } from './ukTaxEntities';

const logger = createLogger('rules-engine-service');

// Inheritance Tax Rates 2024-25
const IHT_NIL_RATE_BAND = 325000; // Per person
const IHT_RESIDENCE_NIL_RATE_BAND = 175000; // Per person (main residence)
const IHT_RATE = 0.40; // 40% above nil rate band
const IHT_REDUCED_RATE = 0.36; // 36% if 10% of estate to charity

export interface InheritanceTaxEstate {
  totalValue: number;
  mainResidence: number;
  otherAssets: number;
  liabilities: number;
  exemptions: number;
  gifts: Array<{
    date: Date;
    amount: number;
    recipient: string;
    isExempt: boolean;
  }>;
}

export interface InheritanceTaxCalculation {
  estateValue: number;
  nilRateBand: number;
  residenceNilRateBand: number;
  totalNilRateBand: number;
  taxableEstate: number;
  ihtBeforeReliefs: number;
  reliefs: {
    spouseExemption: number;
    charityExemption: number;
    businessRelief: number;
    agriculturalRelief: number;
    total: number;
  };
  ihtAfterReliefs: number;
  effectiveRate: number;
  recommendations: string[];
}

export interface InheritanceTaxPlanning {
  strategy: string;
  description: string;
  potentialSaving: number;
  implementation: string[];
  risks: string[];
}

export async function calculateInheritanceTax(
  estate: InheritanceTaxEstate,
  isMarried: boolean = false,
  spouseNilRateBandAvailable: boolean = false,
  charityDonation: number = 0
): Promise<InheritanceTaxCalculation> {
  const estateValue = estate.totalValue - estate.liabilities - estate.exemptions;

  // Nil rate bands
  let nilRateBand = IHT_NIL_RATE_BAND;
  let residenceNilRateBand = IHT_RESIDENCE_NIL_RATE_BAND;

  // Transfer unused nil rate band from spouse
  if (isMarried && spouseNilRateBandAvailable) {
    nilRateBand = nilRateBand * 2;
    residenceNilRateBand = residenceNilRateBand * 2;
  }

  const totalNilRateBand = nilRateBand + residenceNilRateBand;

  // Calculate taxable estate
  let taxableEstate = Math.max(0, estateValue - totalNilRateBand);

  // Reliefs
  const spouseExemption = isMarried ? estateValue : 0; // Unlimited spouse exemption
  const charityExemption = charityDonation;
  const businessRelief = calculateBusinessRelief(estate);
  const agriculturalRelief = calculateAgriculturalRelief(estate);

  const totalReliefs = spouseExemption + charityExemption + businessRelief + agriculturalRelief;
  taxableEstate = Math.max(0, taxableEstate - totalReliefs);

  // IHT calculation
  let ihtBeforeReliefs = taxableEstate * IHT_RATE;

  // Reduced rate if 10% to charity
  const charityPercentage = (charityDonation / estateValue) * 100;
  const ihtRate = charityPercentage >= 10 ? IHT_REDUCED_RATE : IHT_RATE;
  const ihtAfterReliefs = taxableEstate * ihtRate;

  const effectiveRate = estateValue > 0 ? (ihtAfterReliefs / estateValue) * 100 : 0;

  const recommendations: string[] = [];
  if (charityPercentage < 10 && charityDonation > 0) {
    const targetDonation = estateValue * 0.10;
    recommendations.push(`Increase charity donation to £${targetDonation.toLocaleString()} to qualify for 36% IHT rate`);
  }
  if (!isMarried && estateValue > totalNilRateBand) {
    recommendations.push('Consider marriage or civil partnership to access spouse exemption');
  }
  if (estateValue > totalNilRateBand * 2) {
    recommendations.push('Consider gifting assets during lifetime to reduce estate value');
  }

  return {
    estateValue,
    nilRateBand,
    residenceNilRateBand,
    totalNilRateBand,
    taxableEstate,
    ihtBeforeReliefs,
    reliefs: {
      spouseExemption,
      charityExemption,
      businessRelief,
      agriculturalRelief,
      total: totalReliefs,
    },
    ihtAfterReliefs,
    effectiveRate,
    recommendations,
  };
}

function calculateBusinessRelief(estate: InheritanceTaxEstate): number {
  // Business Relief: 100% for unlisted shares, 50% for listed shares
  // Simplified - would need detailed asset breakdown
  return 0; // Would calculate from business assets
}

function calculateAgriculturalRelief(estate: InheritanceTaxEstate): number {
  // Agricultural Relief: 100% for agricultural property
  // Simplified - would need detailed asset breakdown
  return 0; // Would calculate from agricultural assets
}

export async function generateInheritanceTaxPlanning(
  estate: InheritanceTaxEstate,
  currentAge: number,
  lifeExpectancy: number = 85
): Promise<InheritanceTaxPlanning[]> {
  const strategies: InheritanceTaxPlanning[] = [];

  // Lifetime gifting
  if (estate.totalValue > IHT_NIL_RATE_BAND * 2) {
    strategies.push({
      strategy: 'Lifetime Gifting',
      description: 'Gift assets during lifetime to reduce estate value',
      potentialSaving: (estate.totalValue - IHT_NIL_RATE_BAND * 2) * IHT_RATE * 0.5, // 50% of potential IHT
      implementation: [
        'Use annual exemption (£3,000 per year)',
        'Use small gifts exemption (£250 per person)',
        'Make potentially exempt transfers (PETs)',
        'Gift to spouse (unlimited exemption)',
      ],
      risks: ['7-year rule applies', 'Gift with reservation of benefit', 'Loss of control'],
    });
  }

  // Trust planning
  if (estate.totalValue > IHT_NIL_RATE_BAND) {
    strategies.push({
      strategy: 'Trust Planning',
      description: 'Place assets in trust to reduce IHT liability',
      potentialSaving: estate.totalValue * IHT_RATE * 0.3,
      implementation: [
        'Set up discretionary trust',
        'Transfer assets to trust',
        'Appoint trustees',
      ],
      risks: ['Complex administration', 'Trust tax charges', 'Loss of control'],
    });
  }

  // Business/Agricultural Relief
  if (estate.otherAssets > 0) {
    strategies.push({
      strategy: 'Business/Agricultural Relief',
      description: 'Structure assets to qualify for business or agricultural relief',
      potentialSaving: estate.otherAssets * IHT_RATE * 0.5,
      implementation: [
        'Ensure business assets qualify for relief',
        'Maintain qualifying status',
      ],
      risks: ['Must meet qualifying conditions', 'Relief may be withdrawn'],
    });
  }

  // Charity donations
  if (estate.totalValue > IHT_NIL_RATE_BAND) {
    const targetDonation = estate.totalValue * 0.10;
    strategies.push({
      strategy: 'Charity Donations',
      description: 'Donate 10% of estate to charity to qualify for 36% IHT rate',
      potentialSaving: (estate.totalValue - IHT_NIL_RATE_BAND) * (IHT_RATE - IHT_REDUCED_RATE),
      implementation: [
        `Donate £${targetDonation.toLocaleString()} to charity`,
        'Ensure donation is in will',
      ],
      risks: ['Reduces inheritance for beneficiaries'],
    });
  }

  return strategies;
}
