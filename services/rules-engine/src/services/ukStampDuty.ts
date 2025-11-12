import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('rules-engine-service');

// Stamp Duty Land Tax Rates 2024-25
const SDLT_RESIDENTIAL_RATES = [
  { threshold: 0, rate: 0 },
  { threshold: 250000, rate: 0.05 },
  { threshold: 925000, rate: 0.10 },
  { threshold: 1500000, rate: 0.12 },
];

const SDLT_NON_RESIDENTIAL_RATES = [
  { threshold: 0, rate: 0 },
  { threshold: 150000, rate: 0.02 },
  { threshold: 250000, rate: 0.05 },
];

const SDLT_FIRST_TIME_BUYER_THRESHOLD = 625000;
const SDLT_FIRST_TIME_BUYER_RELIEF = 425000;

const SDLT_ADDITIONAL_RATE = 0.03; // 3% for additional properties
const SDLT_NON_RESIDENT_SURCHARGE = 0.02; // 2% for non-residents

export interface StampDutyTransaction {
  propertyValue: number;
  propertyType: 'residential' | 'non_residential' | 'mixed';
  isFirstTimeBuyer: boolean;
  isAdditionalProperty: boolean;
  isNonResident: boolean;
  isBuyToLet: boolean;
  purchaseDate: Date;
}

export interface StampDutyCalculation {
  propertyValue: number;
  propertyType: string;
  baseSDLT: number;
  additionalPropertySurcharge: number;
  nonResidentSurcharge: number;
  firstTimeBuyerRelief: number;
  totalSDLT: number;
  effectiveRate: number;
  breakdown: Array<{
    band: string;
    amount: number;
    rate: number;
    tax: number;
  }>;
  recommendations: string[];
}

export function calculateStampDuty(transaction: StampDutyTransaction): StampDutyCalculation {
  const { propertyValue, propertyType, isFirstTimeBuyer, isAdditionalProperty, isNonResident } = transaction;

  let rates = propertyType === 'residential' ? SDLT_RESIDENTIAL_RATES : SDLT_NON_RESIDENTIAL_RATES;
  const breakdown: Array<{ band: string; amount: number; rate: number; tax: number }> = [];

  // Calculate base SDLT
  let baseSDLT = 0;
  let remainingValue = propertyValue;

  for (let i = rates.length - 1; i >= 0; i--) {
    const rate = rates[i];
    if (remainingValue > rate.threshold) {
      const taxableAmount = remainingValue - rate.threshold;
      const tax = taxableAmount * rate.rate;
      baseSDLT += tax;
      
      breakdown.push({
        band: `£${rate.threshold.toLocaleString()} - £${remainingValue.toLocaleString()}`,
        amount: taxableAmount,
        rate: rate.rate,
        tax,
      });

      remainingValue = rate.threshold;
    }
  }

  // First Time Buyer Relief
  let firstTimeBuyerRelief = 0;
  if (isFirstTimeBuyer && propertyType === 'residential' && propertyValue <= SDLT_FIRST_TIME_BUYER_THRESHOLD) {
    // No SDLT on first £425,000, 5% on next £200,000
    if (propertyValue <= SDLT_FIRST_TIME_BUYER_RELIEF) {
      firstTimeBuyerRelief = baseSDLT;
      baseSDLT = 0;
    } else {
      const reliefAmount = SDLT_FIRST_TIME_BUYER_RELIEF;
      const reliefTax = reliefAmount * 0.05; // Would have been 5%
      firstTimeBuyerRelief = Math.min(reliefTax, baseSDLT);
      baseSDLT = Math.max(0, baseSDLT - firstTimeBuyerRelief);
    }
  }

  // Additional Property Surcharge
  let additionalPropertySurcharge = 0;
  if (isAdditionalProperty && propertyType === 'residential') {
    additionalPropertySurcharge = propertyValue * SDLT_ADDITIONAL_RATE;
  }

  // Non-Resident Surcharge
  let nonResidentSurcharge = 0;
  if (isNonResident && propertyType === 'residential') {
    nonResidentSurcharge = propertyValue * SDLT_NON_RESIDENT_SURCHARGE;
  }

  const totalSDLT = baseSDLT + additionalPropertySurcharge + nonResidentSurcharge;
  const effectiveRate = propertyValue > 0 ? (totalSDLT / propertyValue) * 100 : 0;

  const recommendations: string[] = [];
  if (isFirstTimeBuyer && propertyValue > SDLT_FIRST_TIME_BUYER_THRESHOLD) {
    recommendations.push(`Consider reducing purchase price to £${SDLT_FIRST_TIME_BUYER_THRESHOLD.toLocaleString()} to maximize first-time buyer relief`);
  }
  if (isAdditionalProperty && propertyValue > 40000) {
    recommendations.push('Consider purchasing in company name to potentially reduce SDLT (seek professional advice)');
  }
  if (isNonResident) {
    recommendations.push('Consider establishing UK residency before purchase to avoid non-resident surcharge');
  }

  return {
    propertyValue,
    propertyType,
    baseSDLT,
    additionalPropertySurcharge,
    nonResidentSurcharge,
    firstTimeBuyerRelief,
    totalSDLT,
    effectiveRate,
    breakdown,
    recommendations,
  };
}

export function calculateStampDutySavings(
  currentTransaction: StampDutyTransaction,
  alternativeScenarios: StampDutyTransaction[]
): Array<{
  scenario: string;
  sdlt: number;
  saving: number;
  feasibility: 'high' | 'medium' | 'low';
}> {
  const currentSDLT = calculateStampDuty(currentTransaction).totalSDLT;

  return alternativeScenarios.map(scenario => {
    const scenarioSDLT = calculateStampDuty(scenario).totalSDLT;
    const saving = currentSDLT - scenarioSDLT;

    let feasibility: 'high' | 'medium' | 'low' = 'high';
    if (scenario.isFirstTimeBuyer && !currentTransaction.isFirstTimeBuyer) {
      feasibility = 'low'; // Can't become first-time buyer
    }
    if (scenario.propertyValue !== currentTransaction.propertyValue) {
      feasibility = 'medium'; // Would require negotiation
    }

    return {
      scenario: `Property value: £${scenario.propertyValue.toLocaleString()}, First-time buyer: ${scenario.isFirstTimeBuyer}`,
      sdlt: scenarioSDLT,
      saving,
      feasibility,
    };
  });
}
