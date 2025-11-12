import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('rules-engine-service');

export interface TaxRulepack {
  country: string;
  version: string;
  effectiveFrom: Date;
  effectiveTo?: Date;
  rules: Array<{
    id: string;
    name: string;
    type: 'vat' | 'income_tax' | 'corporate_tax' | 'sales_tax';
    rate: number;
    threshold?: number;
    conditions?: Record<string, unknown>;
  }>;
}

// Pre-defined tax rulepacks for major countries
const TAX_RULEPACKS: Record<string, TaxRulepack> = {
  US: {
    country: 'US',
    version: '2024.1',
    effectiveFrom: new Date('2024-01-01'),
    rules: [
      {
        id: 'us-federal-income-tax',
        name: 'Federal Income Tax',
        type: 'income_tax',
        rate: 0.22, // Average rate
        threshold: 0,
      },
      {
        id: 'us-state-sales-tax',
        name: 'State Sales Tax',
        type: 'sales_tax',
        rate: 0.06, // Average state sales tax
        threshold: 0,
      },
    ],
  },
  CA: {
    country: 'CA',
    version: '2024.1',
    effectiveFrom: new Date('2024-01-01'),
    rules: [
      {
        id: 'ca-gst',
        name: 'GST (Goods and Services Tax)',
        type: 'vat',
        rate: 0.05,
        threshold: 30000, // CAD
      },
      {
        id: 'ca-hst',
        name: 'HST (Harmonized Sales Tax)',
        type: 'vat',
        rate: 0.13, // Ontario
        threshold: 30000,
      },
      {
        id: 'ca-corporate-tax',
        name: 'Federal Corporate Tax',
        type: 'corporate_tax',
        rate: 0.15,
        threshold: 0,
      },
    ],
  },
  AU: {
    country: 'AU',
    version: '2024.1',
    effectiveFrom: new Date('2024-01-01'),
    rules: [
      {
        id: 'au-gst',
        name: 'GST (Goods and Services Tax)',
        type: 'vat',
        rate: 0.10,
        threshold: 75000, // AUD
      },
      {
        id: 'au-corporate-tax',
        name: 'Corporate Tax',
        type: 'corporate_tax',
        rate: 0.30,
        threshold: 0,
      },
    ],
  },
  DE: {
    country: 'DE',
    version: '2024.1',
    effectiveFrom: new Date('2024-01-01'),
    rules: [
      {
        id: 'de-vat-standard',
        name: 'VAT Standard Rate',
        type: 'vat',
        rate: 0.19,
        threshold: 17500, // EUR
      },
      {
        id: 'de-vat-reduced',
        name: 'VAT Reduced Rate',
        type: 'vat',
        rate: 0.07,
        threshold: 17500,
      },
      {
        id: 'de-corporate-tax',
        name: 'Corporate Tax',
        type: 'corporate_tax',
        rate: 0.15,
        threshold: 0,
      },
    ],
  },
  FR: {
    country: 'FR',
    version: '2024.1',
    effectiveFrom: new Date('2024-01-01'),
    rules: [
      {
        id: 'fr-vat-standard',
        name: 'VAT Standard Rate',
        type: 'vat',
        rate: 0.20,
        threshold: 0,
      },
      {
        id: 'fr-corporate-tax',
        name: 'Corporate Tax',
        type: 'corporate_tax',
        rate: 0.25,
        threshold: 0,
      },
    ],
  },
};

export async function getTaxRulepack(country: string, version?: string): Promise<TaxRulepack | null> {
  // First check database
  let query = 'SELECT * FROM tax_rulepacks WHERE country = $1';
  const params: unknown[] = [country.toUpperCase()];

  if (version) {
    query += ' AND version = $2';
    params.push(version);
  } else {
    query += ' ORDER BY version DESC LIMIT 1';
  }

  const result = await db.query<{
    country: string;
    version: string;
    effective_from: Date;
    effective_to: Date | null;
    rules: unknown;
  }>(query, params);

  if (result.rows.length > 0) {
    const row = result.rows[0];
    return {
      country: row.country,
      version: row.version,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to || undefined,
      rules: (row.rules as TaxRulepack['rules']) || [],
    };
  }

  // Fallback to pre-defined rulepacks
  const rulepack = TAX_RULEPACKS[country.toUpperCase()];
  if (rulepack) {
    logger.info('Using pre-defined tax rulepack', { country, version: rulepack.version });
    return rulepack;
  }

  return null;
}

export async function installTaxRulepack(rulepack: TaxRulepack): Promise<void> {
  logger.info('Installing tax rulepack', {
    country: rulepack.country,
    version: rulepack.version,
  });

  await db.query(
    `INSERT INTO tax_rulepacks (country, version, effective_from, effective_to, rules)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (country, version) DO UPDATE
     SET effective_from = $3, effective_to = $4, rules = $5::jsonb, updated_at = NOW()`,
    [
      rulepack.country,
      rulepack.version,
      rulepack.effectiveFrom,
      rulepack.effectiveTo || null,
      JSON.stringify(rulepack.rules),
    ]
  );

  logger.info('Tax rulepack installed', {
    country: rulepack.country,
    version: rulepack.version,
  });
}

export async function calculateTaxForCountry(
  tenantId: TenantId,
  country: string,
  transaction: {
    amount: number;
    type: 'sale' | 'purchase' | 'income' | 'expense';
    category?: string;
  }
): Promise<{
  taxRate: number;
  taxAmount: number;
  ruleId: string;
}> {
  const rulepack = await getTaxRulepack(country);
  if (!rulepack) {
    throw new Error(`No tax rulepack found for country: ${country}`);
  }

  // Determine tax type based on transaction
  let taxType: 'vat' | 'income_tax' | 'corporate_tax' | 'sales_tax' = 'vat';
  if (transaction.type === 'income' || transaction.type === 'expense') {
    taxType = 'income_tax';
  }

  // Find applicable rule
  const applicableRule = rulepack.rules.find(rule => {
    if (rule.type !== taxType) {
      return false;
    }

    if (rule.threshold !== undefined && transaction.amount < rule.threshold) {
      return false;
    }

    return true;
  });

  if (!applicableRule) {
    // Default to first rule of matching type
    const defaultRule = rulepack.rules.find(r => r.type === taxType);
    if (!defaultRule) {
      throw new Error(`No applicable tax rule found for ${taxType} in ${country}`);
    }

    return {
      taxRate: defaultRule.rate,
      taxAmount: transaction.amount * defaultRule.rate,
      ruleId: defaultRule.id,
    };
  }

  return {
    taxRate: applicableRule.rate,
    taxAmount: transaction.amount * applicableRule.rate,
    ruleId: applicableRule.id,
  };
}
