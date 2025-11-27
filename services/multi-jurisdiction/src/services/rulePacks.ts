export type JurisdictionCode = 'EU' | 'US' | 'UK' | 'AU' | 'CA';

export interface FilingRulePack {
  id: string;
  jurisdiction: JurisdictionCode;
  description: string;
  baseCurrency: string;
  regulators: string[];
  coverage: {
    vat?: boolean;
    salesTax?: boolean;
    payroll?: boolean;
    corporateTax?: boolean;
    incomeTax?: boolean;
    gst?: boolean;
  };
  workflows: Array<{
    filingType: string;
    authority: string;
    requirements: string[];
    settlementCurrency?: string;
  }>;
  notes?: string[];
}

const EU_PACK: FilingRulePack = {
  id: 'rulepack-eu',
  jurisdiction: 'EU',
  description: 'EU VAT OSS/IOSS coverage with cross-border logic',
  baseCurrency: 'EUR',
  regulators: ['European Commission', 'Local Tax Authorities'],
  coverage: { vat: true, payroll: true, corporateTax: true, incomeTax: true },
  workflows: [
    {
      filingType: 'VAT',
      authority: 'OSS/IOSS',
      requirements: [
        'Country level VAT rates with reduced and zero bands',
        'Distance selling thresholds monitoring',
        'Evidence bundle of invoices and shipment proofs',
      ],
    },
    {
      filingType: 'PAYE',
      authority: 'Local labour authorities',
      requirements: ['Income tax bands', 'Social security coordination'],
    },
  ],
  notes: ['Supports ECB spot rates for FX conversion.'],
};

const US_PACK: FilingRulePack = {
  id: 'rulepack-us',
  jurisdiction: 'US',
  description: 'US federal and state nexus rule pack',
  baseCurrency: 'USD',
  regulators: ['IRS', 'State Departments of Revenue'],
  coverage: { salesTax: true, payroll: true, corporateTax: true, incomeTax: true },
  workflows: [
    {
      filingType: 'SALES_TAX',
      authority: 'State revenue portals',
      requirements: [
        'Economic nexus thresholds by state',
        'Exemption certificate tracking',
        'Destination-based sourcing rules',
      ],
      settlementCurrency: 'USD',
    },
    {
      filingType: 'CORPORATION_TAX',
      authority: 'IRS',
      requirements: ['Federal return with apportionment schedules', 'State addbacks and credits'],
    },
  ],
  notes: ['Supports state-specific calendars and local option rates.'],
};

const UK_PACK: FilingRulePack = {
  id: 'rulepack-uk',
  jurisdiction: 'UK',
  description: 'HMRC VAT, PAYE, and corporation tax rule pack',
  baseCurrency: 'GBP',
  regulators: ['HMRC'],
  coverage: { vat: true, payroll: true, corporateTax: true },
  workflows: [
    {
      filingType: 'VAT',
      authority: 'HMRC MTD',
      requirements: [
        'MTD compatible VAT submissions',
        'Digital record evidence bundle',
        'EC Sales List and reverse charge logic',
      ],
      settlementCurrency: 'GBP',
    },
    {
      filingType: 'PAYE',
      authority: 'HMRC',
      requirements: ['FPS/EPS schedules', 'RTI alignment and late filing flags'],
      settlementCurrency: 'GBP',
    },
  ],
  notes: ['Pairs with @ai-accountant/hmrc client for submission flows.'],
};

const AU_PACK: FilingRulePack = {
  id: 'rulepack-au',
  jurisdiction: 'AU',
  description: 'Australian BAS/GST and PAYG instalment rule pack',
  baseCurrency: 'AUD',
  regulators: ['ATO'],
  coverage: { gst: true, payroll: true, corporateTax: true },
  workflows: [
    {
      filingType: 'GST',
      authority: 'ATO BAS',
      requirements: ['GST on sales and purchases', 'Fuel tax credits', 'Simplified GST for non-residents'],
      settlementCurrency: 'AUD',
    },
    {
      filingType: 'PAYG',
      authority: 'ATO',
      requirements: ['PAYG withholding instalments', 'Superannuation guarantee evidence'],
      settlementCurrency: 'AUD',
    },
  ],
  notes: ['FX rates sourced via RBA-compatible providers.'],
};

const CA_PACK: FilingRulePack = {
  id: 'rulepack-ca',
  jurisdiction: 'CA',
  description: 'Canadian GST/HST/PST with provincial nuances',
  baseCurrency: 'CAD',
  regulators: ['CRA', 'Provincial Ministries of Finance'],
  coverage: { gst: true, salesTax: true, payroll: true, corporateTax: true },
  workflows: [
    {
      filingType: 'GST_HST',
      authority: 'CRA',
      requirements: ['GST/HST place-of-supply', 'ITC evidence for input tax credits'],
      settlementCurrency: 'CAD',
    },
    {
      filingType: 'PST',
      authority: 'Provincial portals',
      requirements: ['BC, SK, and MB PST returns', 'Provincial exemptions tracking'],
      settlementCurrency: 'CAD',
    },
  ],
  notes: ['Supports Bank of Canada closing rates for translation.'],
};

const RULE_PACKS: FilingRulePack[] = [EU_PACK, US_PACK, UK_PACK, AU_PACK, CA_PACK];

export function listRulePacks(): FilingRulePack[] {
  return RULE_PACKS;
}

export function getRulePackById(id: string): FilingRulePack | undefined {
  return RULE_PACKS.find((pack) => pack.id === id);
}

export function getRulePacksByJurisdiction(jurisdiction: JurisdictionCode): FilingRulePack[] {
  return RULE_PACKS.filter((pack) => pack.jurisdiction === jurisdiction);
}
