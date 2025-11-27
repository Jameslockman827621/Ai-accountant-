import { FilingType } from '@ai-accountant/shared-types';

export type FilingFlowJurisdiction = 'EU' | 'US' | 'UK' | 'AU' | 'CA';

export interface FilingFlowParameters {
  rulePackId: string;
  jurisdiction: FilingFlowJurisdiction;
  baseCurrency: string;
  authority: string;
  valuationMethod: 'spot' | 'average' | 'month_end';
  evidenceRequirements: string[];
}

const FLOW_LIBRARY: Record<string, FilingFlowParameters> = {
  'rulepack-eu:VAT': {
    rulePackId: 'rulepack-eu',
    jurisdiction: 'EU',
    baseCurrency: 'EUR',
    authority: 'OSS/IOSS',
    valuationMethod: 'spot',
    evidenceRequirements: [
      'Country-level VAT rate mapping',
      'Distance selling thresholds',
      'Invoice-level evidence bundle',
    ],
  },
  'rulepack-us:SALES_TAX': {
    rulePackId: 'rulepack-us',
    jurisdiction: 'US',
    baseCurrency: 'USD',
    authority: 'State revenue portals',
    valuationMethod: 'average',
    evidenceRequirements: ['Economic nexus evaluation', 'Exemption certificate register'],
  },
  'rulepack-uk:VAT': {
    rulePackId: 'rulepack-uk',
    jurisdiction: 'UK',
    baseCurrency: 'GBP',
    authority: 'HMRC MTD',
    valuationMethod: 'spot',
    evidenceRequirements: ['Digital links evidence', 'MTD-compatible VAT report'],
  },
  'rulepack-au:GST': {
    rulePackId: 'rulepack-au',
    jurisdiction: 'AU',
    baseCurrency: 'AUD',
    authority: 'ATO BAS',
    valuationMethod: 'month_end',
    evidenceRequirements: ['BAS summary', 'Fuel tax credits calculation'],
  },
  'rulepack-ca:GST_HST': {
    rulePackId: 'rulepack-ca',
    jurisdiction: 'CA',
    baseCurrency: 'CAD',
    authority: 'CRA',
    valuationMethod: 'spot',
    evidenceRequirements: ['GST/HST place-of-supply matrix', 'Input tax credit documentation'],
  },
};

export function getFilingFlowParameters(
  filingType: FilingType,
  rulePackId: string
): FilingFlowParameters | undefined {
  const key = `${rulePackId}:${filingType}`;
  return FLOW_LIBRARY[key];
}

export function listFilingFlowParameters(): FilingFlowParameters[] {
  return Object.values(FLOW_LIBRARY);
}
