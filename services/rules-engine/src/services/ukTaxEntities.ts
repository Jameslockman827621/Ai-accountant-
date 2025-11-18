import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('rules-engine-service');

export type UKEntityType =
  | 'sole_trader'
  | 'freelancer'
  | 'partnership'
  | 'llp'
  | 'ltd'
  | 'plc'
  | 'cic'
  | 'charity'
  | 'community_interest_company'
  | 'social_enterprise'
  | 'trust'
  | 'estate';

export interface EntityTaxProfile {
  entityType: UKEntityType;
  taxYear: string; // e.g., "2024-25"
  incomeTax: {
    applicable: boolean;
    personalAllowance: number;
    basicRate: { threshold: number; rate: number };
    higherRate: { threshold: number; rate: number };
    additionalRate: { threshold: number; rate: number };
    dividendAllowance: number;
    dividendBasicRate: number;
    dividendHigherRate: number;
    dividendAdditionalRate: number;
    savingsAllowance: number;
    savingsBasicRate: number;
    savingsHigherRate: number;
  };
  nationalInsurance: {
    applicable: boolean;
    class2: { weeklyRate: number; smallProfitsThreshold: number };
    class4: { lowerProfitsLimit: number; upperProfitsLimit: number; lowerRate: number; upperRate: number };
    class1: { employeeRate: number; employerRate: number; thresholds: { primary: number; upper: number } };
  };
  corporationTax: {
    applicable: boolean;
    mainRate: number;
    smallProfitsRate: number;
    smallProfitsThreshold: number;
    marginalReliefFraction: number;
    marginalReliefUpperLimit: number;
  };
  vat: {
    registrationThreshold: number;
    deregistrationThreshold: number;
    standardRate: number;
    reducedRate: number;
    zeroRate: boolean;
    exempt: boolean;
    flatRateScheme: boolean;
    flatRatePercentages: Record<string, number>;
  };
  capitalGainsTax: {
    applicable: boolean;
    annualExemptAmount: number;
    basicRate: number;
    higherRate: number;
    entrepreneursReliefRate: number;
    entrepreneursReliefLifetimeLimit: number;
  };
  filingDeadlines: {
    selfAssessment: string; // "31 Jan"
    corporationTax: string; // "9 months after year end"
    vat: string; // "1 month + 7 days after period end"
    paye: string; // "19th of following month"
  };
  allowances: {
    tradingAllowance: number;
    propertyAllowance: number;
    marriageAllowance: number;
    blindPersonsAllowance: number;
  };
  reliefs: {
    annualInvestmentAllowance: number;
    rndSmeRate: number;
    rndLargeRate: number;
    eisRate: number;
    eisMaxInvestment: number;
    seisRate: number;
    seisMaxInvestment: number;
    vctRate: number;
    pensionAnnualAllowance: number;
    pensionLifetimeAllowance: number;
  };
}

const SOLE_TRADER_PROFILE_2024_25: EntityTaxProfile = {
  entityType: 'sole_trader',
  taxYear: '2024-25',
  incomeTax: {
    applicable: true,
    personalAllowance: 12570,
    basicRate: { threshold: 50270, rate: 0.20 },
    higherRate: { threshold: 125140, rate: 0.40 },
    additionalRate: { threshold: Infinity, rate: 0.45 },
    dividendAllowance: 500,
    dividendBasicRate: 0.085,
    dividendHigherRate: 0.335,
    dividendAdditionalRate: 0.391,
    savingsAllowance: 1000,
    savingsBasicRate: 0.20,
    savingsHigherRate: 0.40,
  },
  nationalInsurance: {
    applicable: true,
    class2: { weeklyRate: 3.45, smallProfitsThreshold: 6725 },
    class4: { lowerProfitsLimit: 12570, upperProfitsLimit: 50270, lowerRate: 0.09, upperRate: 0.02 },
    class1: { employeeRate: 0.12, employerRate: 0.138, thresholds: { primary: 12570, upper: 50270 } },
  },
  corporationTax: {
    applicable: false,
    mainRate: 0,
    smallProfitsRate: 0,
    smallProfitsThreshold: 0,
    marginalReliefFraction: 0,
    marginalReliefUpperLimit: 0,
  },
  vat: {
    registrationThreshold: 90000,
    deregistrationThreshold: 88000,
    standardRate: 0.20,
    reducedRate: 0.05,
    zeroRate: true,
    exempt: false,
    flatRateScheme: true,
    flatRatePercentages: {
      'accounting': 14.5,
      'advertising': 11,
      'agriculture': 6.5,
      'architect': 14.5,
      'catering': 12.5,
      'computer': 13.5,
      'construction': 9.5,
      'consultancy': 14.5,
      'estate_agency': 12,
      'financial_services': 13.5,
      'hairdressing': 13,
      'hotel': 10.5,
      'legal': 13.5,
      'manufacturing': 9,
      'medical': 12,
      'printing': 8.5,
      'professional_services': 12,
      'pub': 6.5,
      'retail': 7.5,
      'transport': 10,
    },
  },
  capitalGainsTax: {
    applicable: true,
    annualExemptAmount: 6000,
    basicRate: 0.10,
    higherRate: 0.20,
    entrepreneursReliefRate: 0.10,
    entrepreneursReliefLifetimeLimit: 1000000,
  },
  filingDeadlines: {
    selfAssessment: '31 Jan',
    corporationTax: 'N/A',
    vat: '1 month + 7 days',
    paye: '19th of following month',
  },
  allowances: {
    tradingAllowance: 1000,
    propertyAllowance: 1000,
    marriageAllowance: 1260,
    blindPersonsAllowance: 2980,
  },
  reliefs: {
    annualInvestmentAllowance: 1000000,
    rndSmeRate: 1.86,
    rndLargeRate: 0.20,
    eisRate: 0.30,
    eisMaxInvestment: 2000000,
    seisRate: 0.50,
    seisMaxInvestment: 250000,
    vctRate: 0.30,
    pensionAnnualAllowance: 60000,
    pensionLifetimeAllowance: 1073100,
  },
};

const LTD_PROFILE_2024_25: EntityTaxProfile = {
  entityType: 'ltd',
  taxYear: '2024-25',
  incomeTax: {
    applicable: false,
    personalAllowance: 0,
    basicRate: { threshold: 0, rate: 0 },
    higherRate: { threshold: 0, rate: 0 },
    additionalRate: { threshold: 0, rate: 0 },
    dividendAllowance: 0,
    dividendBasicRate: 0,
    dividendHigherRate: 0,
    dividendAdditionalRate: 0,
    savingsAllowance: 0,
    savingsBasicRate: 0,
    savingsHigherRate: 0,
  },
  nationalInsurance: {
    applicable: true,
    class2: { weeklyRate: 0, smallProfitsThreshold: 0 },
    class4: { lowerProfitsLimit: 0, upperProfitsLimit: 0, lowerRate: 0, upperRate: 0 },
    class1: { employeeRate: 0.12, employerRate: 0.138, thresholds: { primary: 12570, upper: 50270 } },
  },
  corporationTax: {
    applicable: true,
    mainRate: 0.25,
    smallProfitsRate: 0.19,
    smallProfitsThreshold: 50000,
    marginalReliefFraction: 3 / 200,
    marginalReliefUpperLimit: 250000,
  },
  vat: {
    registrationThreshold: 90000,
    deregistrationThreshold: 88000,
    standardRate: 0.20,
    reducedRate: 0.05,
    zeroRate: true,
    exempt: false,
    flatRateScheme: true,
    flatRatePercentages: SOLE_TRADER_PROFILE_2024_25.vat.flatRatePercentages,
  },
  capitalGainsTax: {
    applicable: false,
    annualExemptAmount: 0,
    basicRate: 0,
    higherRate: 0,
    entrepreneursReliefRate: 0,
    entrepreneursReliefLifetimeLimit: 0,
  },
  filingDeadlines: {
    selfAssessment: '31 Jan',
    corporationTax: '9 months after year end',
    vat: '1 month + 7 days',
    paye: '19th of following month',
  },
  allowances: {
    tradingAllowance: 0,
    propertyAllowance: 0,
    marriageAllowance: 0,
    blindPersonsAllowance: 0,
  },
  reliefs: {
    annualInvestmentAllowance: 1000000,
    rndSmeRate: 1.86,
    rndLargeRate: 0.20,
    eisRate: 0.30,
    eisMaxInvestment: 2000000,
    seisRate: 0.50,
    seisMaxInvestment: 250000,
    vctRate: 0.30,
    pensionAnnualAllowance: 60000,
    pensionLifetimeAllowance: 1073100,
  },
};

const CHARITY_PROFILE_2024_25: EntityTaxProfile = {
  entityType: 'charity',
  taxYear: '2024-25',
  incomeTax: {
    applicable: false,
    personalAllowance: 0,
    basicRate: { threshold: 0, rate: 0 },
    higherRate: { threshold: 0, rate: 0 },
    additionalRate: { threshold: 0, rate: 0 },
    dividendAllowance: 0,
    dividendBasicRate: 0,
    dividendHigherRate: 0,
    dividendAdditionalRate: 0,
    savingsAllowance: 0,
    savingsBasicRate: 0,
    savingsHigherRate: 0,
  },
  nationalInsurance: {
    applicable: true,
    class2: { weeklyRate: 0, smallProfitsThreshold: 0 },
    class4: { lowerProfitsLimit: 0, upperProfitsLimit: 0, lowerRate: 0, upperRate: 0 },
    class1: { employeeRate: 0.12, employerRate: 0.138, thresholds: { primary: 12570, upper: 50270 } },
  },
  corporationTax: {
    applicable: true,
    mainRate: 0,
    smallProfitsRate: 0,
    smallProfitsThreshold: 0,
    marginalReliefFraction: 0,
    marginalReliefUpperLimit: 0,
  },
  vat: {
    registrationThreshold: 90000,
    deregistrationThreshold: 88000,
    standardRate: 0.20,
    reducedRate: 0.05,
    zeroRate: true,
    exempt: true,
    flatRateScheme: false,
    flatRatePercentages: {},
  },
  capitalGainsTax: {
    applicable: false,
    annualExemptAmount: 0,
    basicRate: 0,
    higherRate: 0,
    entrepreneursReliefRate: 0,
    entrepreneursReliefLifetimeLimit: 0,
  },
  filingDeadlines: {
    selfAssessment: 'N/A',
    corporationTax: '9 months after year end',
    vat: '1 month + 7 days',
    paye: '19th of following month',
  },
  allowances: {
    tradingAllowance: 0,
    propertyAllowance: 0,
    marriageAllowance: 0,
    blindPersonsAllowance: 0,
  },
  reliefs: {
    annualInvestmentAllowance: 0,
    rndSmeRate: 0,
    rndLargeRate: 0,
    eisRate: 0,
    eisMaxInvestment: 0,
    seisRate: 0,
    seisMaxInvestment: 0,
    vctRate: 0,
    pensionAnnualAllowance: 0,
    pensionLifetimeAllowance: 0,
  },
};

const TRUST_PROFILE_2024_25: EntityTaxProfile = {
  entityType: 'trust',
  taxYear: '2024-25',
  incomeTax: {
    applicable: true,
    personalAllowance: 0,
    basicRate: { threshold: 1000, rate: 0.20 },
    higherRate: { threshold: Infinity, rate: 0.45 },
    additionalRate: { threshold: Infinity, rate: 0.45 },
    dividendAllowance: 500,
    dividendBasicRate: 0.391,
    dividendHigherRate: 0.391,
    dividendAdditionalRate: 0.391,
    savingsAllowance: 500,
    savingsBasicRate: 0.20,
    savingsHigherRate: 0.45,
  },
  nationalInsurance: {
    applicable: false,
    class2: { weeklyRate: 0, smallProfitsThreshold: 0 },
    class4: { lowerProfitsLimit: 0, upperProfitsLimit: 0, lowerRate: 0, upperRate: 0 },
    class1: { employeeRate: 0, employerRate: 0, thresholds: { primary: 0, upper: 0 } },
  },
  corporationTax: {
    applicable: false,
    mainRate: 0,
    smallProfitsRate: 0,
    smallProfitsThreshold: 0,
    marginalReliefFraction: 0,
    marginalReliefUpperLimit: 0,
  },
  vat: {
    registrationThreshold: 90000,
    deregistrationThreshold: 88000,
    standardRate: 0.20,
    reducedRate: 0.05,
    zeroRate: true,
    exempt: false,
    flatRateScheme: false,
    flatRatePercentages: {},
  },
  capitalGainsTax: {
    applicable: true,
    annualExemptAmount: 1500,
    basicRate: 0.20,
    higherRate: 0.20,
    entrepreneursReliefRate: 0.10,
    entrepreneursReliefLifetimeLimit: 1000000,
  },
  filingDeadlines: {
    selfAssessment: '31 Jan',
    corporationTax: 'N/A',
    vat: '1 month + 7 days',
    paye: 'N/A',
  },
  allowances: {
    tradingAllowance: 0,
    propertyAllowance: 0,
    marriageAllowance: 0,
    blindPersonsAllowance: 0,
  },
  reliefs: {
    annualInvestmentAllowance: 0,
    rndSmeRate: 0,
    rndLargeRate: 0,
    eisRate: 0,
    eisMaxInvestment: 0,
    seisRate: 0,
    seisMaxInvestment: 0,
    vctRate: 0,
    pensionAnnualAllowance: 0,
    pensionLifetimeAllowance: 0,
  },
};

const PARTNERSHIP_PROFILE_2024_25: EntityTaxProfile = {
  ...SOLE_TRADER_PROFILE_2024_25,
  entityType: 'partnership',
  incomeTax: {
    ...SOLE_TRADER_PROFILE_2024_25.incomeTax,
  },
};

const LLP_PROFILE_2024_25: EntityTaxProfile = {
  ...PARTNERSHIP_PROFILE_2024_25,
  entityType: 'llp',
};
// UK Tax Rates 2024-25 (Current as of 2024)
const TAX_YEAR_2024_25: Record<UKEntityType, EntityTaxProfile> = {
  sole_trader: SOLE_TRADER_PROFILE_2024_25,
  freelancer: {
    ...SOLE_TRADER_PROFILE_2024_25,
    entityType: 'freelancer',
  },
  partnership: PARTNERSHIP_PROFILE_2024_25,
  llp: LLP_PROFILE_2024_25,
  ltd: LTD_PROFILE_2024_25,
  plc: {
    ...LTD_PROFILE_2024_25,
    entityType: 'plc',
    corporationTax: {
      ...LTD_PROFILE_2024_25.corporationTax,
      smallProfitsRate: 0.25,
    },
  },
  cic: {
    ...LTD_PROFILE_2024_25,
    entityType: 'cic',
    corporationTax: {
      ...LTD_PROFILE_2024_25.corporationTax,
    },
  },
  charity: CHARITY_PROFILE_2024_25,
  community_interest_company: {
    ...LTD_PROFILE_2024_25,
    entityType: 'community_interest_company',
  },
  social_enterprise: {
    ...LTD_PROFILE_2024_25,
    entityType: 'social_enterprise',
  },
  trust: TRUST_PROFILE_2024_25,
  estate: {
    ...TRUST_PROFILE_2024_25,
    entityType: 'estate',
  },
};


export async function getEntityTaxProfile(
  tenantId: TenantId,
  entityType?: UKEntityType
): Promise<EntityTaxProfile> {
  // Get entity type from tenant if not provided
  if (!entityType) {
    const tenantResult = await db.query<{ entity_type: string }>(
      'SELECT entity_type FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (tenantResult.rows.length === 0) {
      throw new Error('Tenant not found');
    }

    entityType = (tenantResult.rows[0]?.entity_type || 'sole_trader') as UKEntityType;
  }

  const profile = TAX_YEAR_2024_25[entityType];
  if (!profile) {
    logger.warn('Unknown entity type, defaulting to sole_trader', { entityType, tenantId });
    return TAX_YEAR_2024_25.sole_trader;
  }

  return profile;
}

export async function setEntityType(tenantId: TenantId, entityType: UKEntityType): Promise<void> {
  await db.query(
    'UPDATE tenants SET entity_type = $1, updated_at = NOW() WHERE id = $2',
    [entityType, tenantId]
  );

  logger.info('Entity type set', { tenantId, entityType });
}

export function getAllEntityTypes(): UKEntityType[] {
  return Object.keys(TAX_YEAR_2024_25) as UKEntityType[];
}

export function getEntityTypeDescription(entityType: UKEntityType): string {
  const descriptions: Record<UKEntityType, string> = {
    sole_trader: 'Sole Trader - Individual running a business',
    freelancer: 'Freelancer - Self-employed individual providing services',
    partnership: 'Partnership - Two or more people in business together',
    llp: 'Limited Liability Partnership - Partnership with limited liability',
    ltd: 'Private Limited Company - Limited company (Ltd)',
    plc: 'Public Limited Company - Publicly traded company (PLC)',
    cic: 'Community Interest Company - Social enterprise structure',
    charity: 'Charity - Registered charity (exempt from most taxes)',
    community_interest_company: 'Community Interest Company - Social enterprise',
    social_enterprise: 'Social Enterprise - Business with social objectives',
    trust: 'Trust - Legal arrangement for holding assets',
    estate: 'Estate - Assets of deceased person',
  };

  return descriptions[entityType] || 'Unknown entity type';
}
