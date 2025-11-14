import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { determineVATRate } from './ukVATCalculations';

const logger = createLogger('rules-engine-service');

export type IndustryType =
  | 'retail'
  | 'hospitality'
  | 'construction'
  | 'professional_services'
  | 'technology'
  | 'healthcare'
  | 'education'
  | 'charity'
  | 'property'
  | 'manufacturing'
  | 'agriculture'
  | 'transport'
  | 'entertainment'
  | 'financial_services'
  | 'other';

export interface IndustryTaxRules {
  industry: IndustryType;
  vatRules: {
    standardItems: string[];
    reducedRateItems: string[];
    zeroRateItems: string[];
    exemptItems: string[];
    flatRateSchemeRate?: number;
  };
  specificReliefs: {
    available: string[];
    conditions: Record<string, string>;
  };
  complianceRequirements: string[];
  commonExpenses: Array<{
    category: string;
    deductible: boolean;
    conditions: string;
  }>;
}

const INDUSTRY_RULES: Record<IndustryType, IndustryTaxRules> = {
  retail: {
    industry: 'retail',
    vatRules: {
      standardItems: ['general goods', 'clothing', 'electronics'],
      reducedRateItems: ['childrens_clothing', 'energy_efficient_items'],
      zeroRateItems: ['books', 'newspapers', 'childrens_clothes', 'prescription_medicines', 'food'],
      exemptItems: [],
      flatRateSchemeRate: 7.5,
    },
    specificReliefs: {
      available: ['annual_investment_allowance'],
      conditions: {},
    },
    complianceRequirements: [
      'VAT registration if turnover > £90,000',
      'Keep records of all sales',
      'Issue VAT invoices',
    ],
    commonExpenses: [
      { category: 'stock', deductible: true, conditions: 'When sold' },
      { category: 'premises', deductible: true, conditions: 'Business use only' },
      { category: 'staff', deductible: true, conditions: 'All staff costs' },
    ],
  },
  hospitality: {
    industry: 'hospitality',
    vatRules: {
      standardItems: ['alcohol', 'hot_food', 'accommodation'],
      reducedRateItems: [],
      zeroRateItems: ['cold_food', 'takeaway_food'],
      exemptItems: [],
      flatRateSchemeRate: 12.5,
    },
    specificReliefs: {
      available: ['annual_investment_allowance'],
      conditions: {},
    },
    complianceRequirements: [
      'VAT registration if turnover > £90,000',
      'Different VAT rates for hot vs cold food',
      'Tourist VAT refund scheme compliance',
    ],
    commonExpenses: [
      { category: 'food_supplies', deductible: true, conditions: 'Business use' },
      { category: 'premises', deductible: true, conditions: 'Business use' },
      { category: 'utilities', deductible: true, conditions: 'Business use' },
    ],
  },
  construction: {
    industry: 'construction',
    vatRules: {
      standardItems: ['construction_services', 'materials'],
      reducedRateItems: ['energy_efficient_installations'],
      zeroRateItems: ['new_build_residential', 'residential_conversions'],
      exemptItems: [],
      flatRateSchemeRate: 9.5,
    },
    specificReliefs: {
      available: ['annual_investment_allowance', 'construction_industry_scheme'],
      conditions: {
        cis: 'Must register for CIS if subcontracting',
      },
    },
    complianceRequirements: [
      'CIS registration required',
      'Deduct CIS from subcontractors',
      'File CIS returns monthly',
      'VAT reverse charge for construction services',
    ],
    commonExpenses: [
      { category: 'materials', deductible: true, conditions: 'Business use' },
      { category: 'subcontractors', deductible: true, conditions: 'CIS deducted' },
      { category: 'plant_equipment', deductible: true, conditions: 'Capital allowances' },
    ],
  },
  professional_services: {
    industry: 'professional_services',
    vatRules: {
      standardItems: ['consulting', 'legal_services', 'accounting_services'],
      reducedRateItems: [],
      zeroRateItems: [],
      exemptItems: ['insurance', 'financial_advice'],
      flatRateSchemeRate: 14.5,
    },
    specificReliefs: {
      available: ['annual_investment_allowance'],
      conditions: {},
    },
    complianceRequirements: [
      'VAT registration if turnover > £90,000',
      'Professional indemnity insurance may be required',
    ],
    commonExpenses: [
      { category: 'professional_development', deductible: true, conditions: 'Business related' },
      { category: 'office_costs', deductible: true, conditions: 'Business use' },
      { category: 'software', deductible: true, conditions: 'Business use' },
    ],
  },
  technology: {
    industry: 'technology',
    vatRules: {
      standardItems: ['software_licenses', 'consulting', 'hardware'],
      reducedRateItems: [],
      zeroRateItems: ['ebooks', 'digital_publications'],
      exemptItems: [],
      flatRateSchemeRate: 14.5,
    },
    specificReliefs: {
      available: ['rnd_tax_relief', 'annual_investment_allowance', 'patent_box'],
      conditions: {
        rnd: 'Must meet BEIS R&D guidelines',
        patent_box: 'Must own qualifying IP',
      },
    },
    complianceRequirements: [
      'VAT registration if turnover > £90,000',
      'R&D claims require detailed documentation',
    ],
    commonExpenses: [
      { category: 'software', deductible: true, conditions: 'Business use' },
      { category: 'rnd', deductible: true, conditions: 'Qualifying R&D activities' },
      { category: 'equipment', deductible: true, conditions: 'Capital allowances' },
    ],
  },
  healthcare: {
    industry: 'healthcare',
    vatRules: {
      standardItems: ['private_treatment'],
      reducedRateItems: [],
      zeroRateItems: ['prescription_medicines', 'medical_devices'],
      exemptItems: ['nhs_services', 'dental_treatment', 'optician_services'],
      flatRateSchemeRate: 0,
    },
    specificReliefs: {
      available: ['annual_investment_allowance'],
      conditions: {},
    },
    complianceRequirements: [
      'VAT registration if turnover > £90,000',
      'Different VAT treatment for NHS vs private',
    ],
    commonExpenses: [
      { category: 'medical_equipment', deductible: true, conditions: 'Business use' },
      { category: 'premises', deductible: true, conditions: 'Business use' },
      { category: 'professional_registration', deductible: true, conditions: 'Required for practice' },
    ],
  },
  education: {
    industry: 'education',
    vatRules: {
      standardItems: [],
      reducedRateItems: [],
      zeroRateItems: ['books', 'educational_materials'],
      exemptItems: ['tuition', 'exam_fees', 'accreditation'],
      flatRateSchemeRate: 0,
    },
    specificReliefs: {
      available: ['annual_investment_allowance'],
      conditions: {},
    },
    complianceRequirements: [
      'VAT registration if turnover > £90,000',
      'Most educational services are VAT exempt',
    ],
    commonExpenses: [
      { category: 'educational_materials', deductible: true, conditions: 'Business use' },
      { category: 'premises', deductible: true, conditions: 'Business use' },
      { category: 'staff', deductible: true, conditions: 'All staff costs' },
    ],
  },
  charity: {
    industry: 'charity',
    vatRules: {
      standardItems: [],
      reducedRateItems: [],
      zeroRateItems: ['charity_publications'],
      exemptItems: ['charitable_activities', 'fundraising'],
      flatRateSchemeRate: 0,
    },
    specificReliefs: {
      available: ['charity_reliefs', 'gift_aid'],
      conditions: {
        gift_aid: 'Must be registered charity',
      },
    },
    complianceRequirements: [
      'Charity registration required',
      'Gift Aid compliance',
      'Most activities VAT exempt',
    ],
    commonExpenses: [
      { category: 'charitable_activities', deductible: true, conditions: 'Charitable purpose' },
      { category: 'fundraising', deductible: true, conditions: 'Charitable purpose' },
    ],
  },
  property: {
    industry: 'property',
    vatRules: {
      standardItems: ['commercial_property', 'property_management'],
      reducedRateItems: ['residential_renovations'],
      zeroRateItems: ['new_residential_builds'],
      exemptItems: ['residential_rent', 'land_sales'],
      flatRateSchemeRate: 0,
    },
    specificReliefs: {
      available: ['annual_investment_allowance', 'capital_allowances'],
      conditions: {},
    },
    complianceRequirements: [
      'VAT registration if turnover > £90,000',
      'SDLT compliance for property purchases',
      'Different VAT treatment for residential vs commercial',
    ],
    commonExpenses: [
      { category: 'property_maintenance', deductible: true, conditions: 'Revenue expense' },
      { category: 'property_improvements', deductible: false, conditions: 'Capital expense - use allowances' },
      { category: 'legal_fees', deductible: true, conditions: 'Property acquisition' },
    ],
  },
  manufacturing: {
    industry: 'manufacturing',
    vatRules: {
      standardItems: ['manufactured_goods'],
      reducedRateItems: [],
      zeroRateItems: ['exports', 'childrens_clothing'],
      exemptItems: [],
      flatRateSchemeRate: 10.5,
    },
    specificReliefs: {
      available: ['rnd_tax_relief', 'annual_investment_allowance', 'capital_allowances'],
      conditions: {
        rnd: 'Must meet BEIS R&D guidelines',
      },
    },
    complianceRequirements: [
      'VAT registration if turnover > £90,000',
      'Export documentation',
    ],
    commonExpenses: [
      { category: 'raw_materials', deductible: true, conditions: 'When used' },
      { category: 'manufacturing_equipment', deductible: true, conditions: 'Capital allowances' },
      { category: 'rnd', deductible: true, conditions: 'Qualifying R&D' },
    ],
  },
  agriculture: {
    industry: 'agriculture',
    vatRules: {
      standardItems: ['processed_food'],
      reducedRateItems: [],
      zeroRateItems: ['livestock', 'seeds', 'fertilizer', 'animal_feed'],
      exemptItems: ['land_sales'],
      flatRateSchemeRate: 6.5,
    },
    specificReliefs: {
      available: ['annual_investment_allowance', 'agricultural_reliefs'],
      conditions: {},
    },
    complianceRequirements: [
      'VAT registration if turnover > £90,000',
      'Agricultural subsidies compliance',
    ],
    commonExpenses: [
      { category: 'livestock', deductible: true, conditions: 'Business use' },
      { category: 'equipment', deductible: true, conditions: 'Capital allowances' },
      { category: 'land_improvements', deductible: true, conditions: 'Capital allowances' },
    ],
  },
  transport: {
    industry: 'transport',
    vatRules: {
      standardItems: ['passenger_transport', 'freight'],
      reducedRateItems: [],
      zeroRateItems: [],
      exemptItems: ['international_transport'],
      flatRateSchemeRate: 10,
    },
    specificReliefs: {
      available: ['annual_investment_allowance'],
      conditions: {},
    },
    complianceRequirements: [
      'VAT registration if turnover > £90,000',
      'Operator licensing',
    ],
    commonExpenses: [
      { category: 'fuel', deductible: true, conditions: 'Business use' },
      { category: 'vehicle_maintenance', deductible: true, conditions: 'Business vehicles' },
      { category: 'vehicles', deductible: true, conditions: 'Capital allowances' },
    ],
  },
  entertainment: {
    industry: 'entertainment',
    vatRules: {
      standardItems: ['ticket_sales', 'merchandise'],
      reducedRateItems: [],
      zeroRateItems: ['books', 'recordings'],
      exemptItems: [],
      flatRateSchemeRate: 12.5,
    },
    specificReliefs: {
      available: ['annual_investment_allowance'],
      conditions: {},
    },
    complianceRequirements: [
      'VAT registration if turnover > £90,000',
    ],
    commonExpenses: [
      { category: 'venue_costs', deductible: true, conditions: 'Business use' },
      { category: 'equipment', deductible: true, conditions: 'Capital allowances' },
    ],
  },
  financial_services: {
    industry: 'financial_services',
    vatRules: {
      standardItems: [],
      reducedRateItems: [],
      zeroRateItems: [],
      exemptItems: ['financial_advice', 'insurance', 'banking_services', 'investment_management'],
      flatRateSchemeRate: 0,
    },
    specificReliefs: {
      available: [],
      conditions: {},
    },
    complianceRequirements: [
      'FCA registration may be required',
      'Most services VAT exempt',
    ],
    commonExpenses: [
      { category: 'professional_services', deductible: true, conditions: 'Business use' },
      { category: 'compliance_costs', deductible: true, conditions: 'Regulatory requirements' },
    ],
  },
  other: {
    industry: 'other',
    vatRules: {
      standardItems: ['general_services'],
      reducedRateItems: [],
      zeroRateItems: [],
      exemptItems: [],
      flatRateSchemeRate: 16.5,
    },
    specificReliefs: {
      available: ['annual_investment_allowance'],
      conditions: {},
    },
    complianceRequirements: [
      'VAT registration if turnover > £90,000',
    ],
    commonExpenses: [
      { category: 'general_expenses', deductible: true, conditions: 'Wholly and exclusively for business' },
    ],
  },
};

export async function getIndustryRules(industry: IndustryType): Promise<IndustryTaxRules> {
  return INDUSTRY_RULES[industry] || INDUSTRY_RULES.other;
}

export async function determineIndustryVATRate(
  industry: IndustryType,
  category: string,
  description: string
): Promise<'standard' | 'reduced' | 'zero' | 'exempt'> {
  const rules = await getIndustryRules(industry);
  
  // Check exempt items first
  if (rules.vatRules.exemptItems.some(item => 
    category.toLowerCase().includes(item) || description.toLowerCase().includes(item)
  )) {
    return 'exempt';
  }

  // Check zero rate items
  if (rules.vatRules.zeroRateItems.some(item => 
    category.toLowerCase().includes(item) || description.toLowerCase().includes(item)
  )) {
    return 'zero';
  }

  // Check reduced rate items
  if (rules.vatRules.reducedRateItems.some(item => 
    category.toLowerCase().includes(item) || description.toLowerCase().includes(item)
  )) {
    return 'reduced';
  }

  // Default to standard
  return 'standard';
}

export async function getIndustrySpecificReliefs(
  tenantId: TenantId,
  industry: IndustryType
): Promise<Array<{ name: string; available: boolean; conditions: string }>> {
  const rules = await getIndustryRules(industry);
  
  return rules.specificReliefs.available.map(relief => ({
    name: relief,
    available: true,
    conditions: rules.specificReliefs.conditions[relief] || '',
  }));
}
