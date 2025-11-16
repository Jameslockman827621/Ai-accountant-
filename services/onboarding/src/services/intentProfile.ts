import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

const logger = createLogger('intent-profile-service');

export interface IntentProfileInput {
  tenantId: TenantId;
  userId: UserId;
  entityType: string;
  businessName: string;
  industry?: string;
  employeesCount?: number;
  annualRevenueRange?: string;
  primaryJurisdiction: string;
  additionalJurisdictions?: string[];
  vatNumber?: string;
  salesTaxRegistrations?: Array<{ state: string; registrationNumber: string }>;
  taxAuthorityRegistrations?: Array<{ authority: string; registrationNumber: string; country: string }>;
  fiscalYearStartMonth?: number;
  fiscalYearEndMonth?: number;
  accountingMethod?: 'cash' | 'accrual' | 'hybrid';
  taxObligations?: string[];
  vatRegistered?: boolean;
  payrollEnabled?: boolean;
  filingFrequency?: 'monthly' | 'quarterly' | 'annually' | 'custom';
  connectedSystems?: Array<{ type: string; provider: string; connectedAt: string }>;
  primaryGoals?: string[];
  riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
  automationPreferences?: Record<string, unknown>;
  businessDescription?: string;
  keyContacts?: Array<{ name: string; role: string; email?: string }>;
  specialRequirements?: string;
}

export class IntentProfileService {
  async createOrUpdateProfile(input: IntentProfileInput): Promise<void> {
    // Check if profile exists
    const existing = await db.query<{ id: string }>(
      'SELECT id FROM intent_profiles WHERE tenant_id = $1',
      [input.tenantId]
    );

    const profileData = {
      entity_type: input.entityType,
      business_name: input.businessName,
      industry: input.industry || null,
      employees_count: input.employeesCount || null,
      annual_revenue_range: input.annualRevenueRange || null,
      primary_jurisdiction: input.primaryJurisdiction,
      additional_jurisdictions: input.additionalJurisdictions || [],
      vat_number: input.vatNumber || null,
      sales_tax_registrations: input.salesTaxRegistrations || [],
      tax_authority_registrations: input.taxAuthorityRegistrations || [],
      fiscal_year_start_month: input.fiscalYearStartMonth || null,
      fiscal_year_end_month: input.fiscalYearEndMonth || null,
      accounting_method: input.accountingMethod || null,
      tax_obligations: input.taxObligations || [],
      vat_registered: input.vatRegistered || false,
      payroll_enabled: input.payrollEnabled || false,
      filing_frequency: input.filingFrequency || null,
      connected_systems: input.connectedSystems || [],
      primary_goals: input.primaryGoals || [],
      risk_tolerance: input.riskTolerance || null,
      automation_preferences: input.automationPreferences || {},
      business_description: input.businessDescription || null,
      key_contacts: input.keyContacts || [],
      special_requirements: input.specialRequirements || null,
    };

    if (existing.rows.length > 0) {
      // Update existing
      await db.query(
        `UPDATE intent_profiles
         SET entity_type = $1, business_name = $2, industry = $3,
             employees_count = $4, annual_revenue_range = $5,
             primary_jurisdiction = $6, additional_jurisdictions = $7,
             vat_number = $8, sales_tax_registrations = $9::jsonb,
             tax_authority_registrations = $10::jsonb,
             fiscal_year_start_month = $11, fiscal_year_end_month = $12,
             accounting_method = $13, tax_obligations = $14,
             vat_registered = $15, payroll_enabled = $16,
             filing_frequency = $17, connected_systems = $18::jsonb,
             primary_goals = $19, risk_tolerance = $20,
             automation_preferences = $21::jsonb,
             business_description = $22, key_contacts = $23::jsonb,
             special_requirements = $24,
             profile_completeness = $25,
             updated_at = NOW()
         WHERE tenant_id = $26`,
        [
          profileData.entity_type,
          profileData.business_name,
          profileData.industry,
          profileData.employees_count,
          profileData.annual_revenue_range,
          profileData.primary_jurisdiction,
          JSON.stringify(profileData.additional_jurisdictions),
          profileData.vat_number,
          JSON.stringify(profileData.sales_tax_registrations),
          JSON.stringify(profileData.tax_authority_registrations),
          profileData.fiscal_year_start_month,
          profileData.fiscal_year_end_month,
          profileData.accounting_method,
          profileData.tax_obligations,
          profileData.vat_registered,
          profileData.payroll_enabled,
          profileData.filing_frequency,
          JSON.stringify(profileData.connected_systems),
          profileData.primary_goals,
          profileData.risk_tolerance,
          JSON.stringify(profileData.automation_preferences),
          profileData.business_description,
          JSON.stringify(profileData.key_contacts),
          profileData.special_requirements,
          this.calculateCompleteness(profileData),
          input.tenantId,
        ]
      );
    } else {
      // Create new
      await db.query(
        `INSERT INTO intent_profiles (
          tenant_id, entity_type, business_name, industry, employees_count,
          annual_revenue_range, primary_jurisdiction, additional_jurisdictions,
          vat_number, sales_tax_registrations, tax_authority_registrations,
          fiscal_year_start_month, fiscal_year_end_month, accounting_method,
          tax_obligations, vat_registered, payroll_enabled, filing_frequency,
          connected_systems, primary_goals, risk_tolerance, automation_preferences,
          business_description, key_contacts, special_requirements,
          profile_completeness, created_by, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
          $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $21,
          $22::jsonb, $23, $24::jsonb, $25, $26, $27, NOW(), NOW()
        )`,
        [
          input.tenantId,
          profileData.entity_type,
          profileData.business_name,
          profileData.industry,
          profileData.employees_count,
          profileData.annual_revenue_range,
          profileData.primary_jurisdiction,
          JSON.stringify(profileData.additional_jurisdictions),
          profileData.vat_number,
          JSON.stringify(profileData.sales_tax_registrations),
          JSON.stringify(profileData.tax_authority_registrations),
          profileData.fiscal_year_start_month,
          profileData.fiscal_year_end_month,
          profileData.accounting_method,
          profileData.tax_obligations,
          profileData.vat_registered,
          profileData.payroll_enabled,
          profileData.filing_frequency,
          JSON.stringify(profileData.connected_systems),
          profileData.primary_goals,
          profileData.risk_tolerance,
          JSON.stringify(profileData.automation_preferences),
          profileData.business_description,
          JSON.stringify(profileData.key_contacts),
          profileData.special_requirements,
          this.calculateCompleteness(profileData),
          input.userId,
        ]
      );
    }

    logger.info('Intent profile saved', { tenantId: input.tenantId });
  }

  async getProfile(tenantId: TenantId): Promise<Record<string, unknown> | null> {
    const result = await db.query(
      'SELECT * FROM intent_profiles WHERE tenant_id = $1',
      [tenantId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0] as Record<string, unknown>;
  }

  private calculateCompleteness(profileData: Record<string, unknown>): number {
    const requiredFields = [
      'entity_type',
      'business_name',
      'primary_jurisdiction',
      'tax_obligations',
    ];

    const optionalFields = [
      'industry',
      'employees_count',
      'annual_revenue_range',
      'vat_number',
      'fiscal_year_start_month',
      'accounting_method',
      'filing_frequency',
      'primary_goals',
      'business_description',
    ];

    let score = 0;
    const maxScore = requiredFields.length * 2 + optionalFields.length;

    // Required fields worth 2 points each
    for (const field of requiredFields) {
      const value = profileData[field];
      if (value !== null && value !== undefined && value !== '') {
        if (Array.isArray(value)) {
          if (value.length > 0) score += 2;
        } else {
          score += 2;
        }
      }
    }

    // Optional fields worth 1 point each
    for (const field of optionalFields) {
      const value = profileData[field];
      if (value !== null && value !== undefined && value !== '') {
        if (Array.isArray(value)) {
          if (value.length > 0) score += 1;
        } else {
          score += 1;
        }
      }
    }

    return Math.round((score / maxScore) * 100);
  }
}

export const intentProfileService = new IntentProfileService();
