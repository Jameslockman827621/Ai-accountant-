import { createLogger } from '@ai-accountant/shared-utils';

const logger = createLogger('eu-tax-system');

export interface EUTaxInfo {
  country: string;
  countryCode: string;
  vatRate: number;
  reducedVatRate: number;
  incomeTaxRate: number;
  corporateTaxRate: number;
  currency: string;
}

// EU Tax Information (simplified)
const EU_TAX_INFO: Record<string, EUTaxInfo> = {
  DE: {
    country: 'Germany',
    countryCode: 'DE',
    vatRate: 0.19,
    reducedVatRate: 0.07,
    incomeTaxRate: 0.45, // Top rate
    corporateTaxRate: 0.15,
    currency: 'EUR',
  },
  FR: {
    country: 'France',
    countryCode: 'FR',
    vatRate: 0.20,
    reducedVatRate: 0.055,
    incomeTaxRate: 0.45, // Top rate
    corporateTaxRate: 0.25,
    currency: 'EUR',
  },
  ES: {
    country: 'Spain',
    countryCode: 'ES',
    vatRate: 0.21,
    reducedVatRate: 0.10,
    incomeTaxRate: 0.45, // Top rate
    corporateTaxRate: 0.25,
    currency: 'EUR',
  },
  IT: {
    country: 'Italy',
    countryCode: 'IT',
    vatRate: 0.22,
    reducedVatRate: 0.10,
    incomeTaxRate: 0.43, // Top rate
    corporateTaxRate: 0.24,
    currency: 'EUR',
  },
  NL: {
    country: 'Netherlands',
    countryCode: 'NL',
    vatRate: 0.21,
    reducedVatRate: 0.09,
    incomeTaxRate: 0.49, // Top rate
    corporateTaxRate: 0.25,
    currency: 'EUR',
  },
  BE: {
    country: 'Belgium',
    countryCode: 'BE',
    vatRate: 0.21,
    reducedVatRate: 0.06,
    incomeTaxRate: 0.50, // Top rate
    corporateTaxRate: 0.25,
    currency: 'EUR',
  },
  AT: {
    country: 'Austria',
    countryCode: 'AT',
    vatRate: 0.20,
    reducedVatRate: 0.10,
    incomeTaxRate: 0.55, // Top rate
    corporateTaxRate: 0.25,
    currency: 'EUR',
  },
  IE: {
    country: 'Ireland',
    countryCode: 'IE',
    vatRate: 0.23,
    reducedVatRate: 0.135,
    incomeTaxRate: 0.40, // Top rate
    corporateTaxRate: 0.125,
    currency: 'EUR',
  },
  PT: {
    country: 'Portugal',
    countryCode: 'PT',
    vatRate: 0.23,
    reducedVatRate: 0.06,
    incomeTaxRate: 0.48, // Top rate
    corporateTaxRate: 0.21,
    currency: 'EUR',
  },
  SE: {
    country: 'Sweden',
    countryCode: 'SE',
    vatRate: 0.25,
    reducedVatRate: 0.12,
    incomeTaxRate: 0.57, // Top rate
    corporateTaxRate: 0.20,
    currency: 'SEK',
  },
  DK: {
    country: 'Denmark',
    countryCode: 'DK',
    vatRate: 0.25,
    reducedVatRate: 0.00,
    incomeTaxRate: 0.56, // Top rate
    corporateTaxRate: 0.22,
    currency: 'DKK',
  },
  FI: {
    country: 'Finland',
    countryCode: 'FI',
    vatRate: 0.24,
    reducedVatRate: 0.14,
    incomeTaxRate: 0.31, // Top rate
    corporateTaxRate: 0.20,
    currency: 'EUR',
  },
};

export function getEUTaxInfo(countryCode: string): EUTaxInfo | null {
  return EU_TAX_INFO[countryCode.toUpperCase()] || null;
}

export function calculateEUVAT(amount: number, countryCode: string, isReduced: boolean = false): number {
  const taxInfo = getEUTaxInfo(countryCode);
  if (!taxInfo) {
    logger.warn(`Unknown EU country code: ${countryCode}`);
    return 0;
  }

  const rate = isReduced ? taxInfo.reducedVatRate : taxInfo.vatRate;
  return Math.round(amount * rate * 100) / 100;
}

export function calculateEUIncomeTax(income: number, countryCode: string): number {
  const taxInfo = getEUTaxInfo(countryCode);
  if (!taxInfo) {
    logger.warn(`Unknown EU country code: ${countryCode}`);
    return 0;
  }

  // Simplified calculation - actual EU countries have progressive brackets
  return Math.round(income * taxInfo.incomeTaxRate * 100) / 100;
}

export function calculateEUCorporateTax(profit: number, countryCode: string): number {
  const taxInfo = getEUTaxInfo(countryCode);
  if (!taxInfo) {
    logger.warn(`Unknown EU country code: ${countryCode}`);
    return 0;
  }

  return Math.round(profit * taxInfo.corporateTaxRate * 100) / 100;
}

export function getAllEUCountries(): EUTaxInfo[] {
  return Object.values(EU_TAX_INFO);
}
