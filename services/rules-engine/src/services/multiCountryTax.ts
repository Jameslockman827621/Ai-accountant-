import { createHash } from 'crypto';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import {
  RulepackTransactionInput,
  TaxRegressionCase,
  TaxRegressionSummary,
  TaxRulepack,
  TaxRulepackStatus,
  TenantId,
} from '@ai-accountant/shared-types';
import { InstallableTaxRulepack } from './rulepackTypes';
import { getBuiltInUSRulepacks } from '../../../multi-jurisdiction/src/services/usTaxSystem';
import { getBuiltInEUTaxRulepacks } from '../../../multi-jurisdiction/src/services/euTaxSystem';

const logger = createLogger('rules-engine-service');

type RulepackCalculationResult = {
  taxRate: number;
  taxAmount: number;
  ruleId: string;
  jurisdictionCode: string;
  rulepackVersion: string;
  filingBoxes?: Record<string, number>;
  details?: Record<string, unknown>;
};

type RulepackQueryOptions = {
  year?: number;
  status?: TaxRulepackStatus;
  includeInactive?: boolean;
};

type RegressionCaseResult = {
  caseId: string;
  status: 'pass' | 'fail' | 'skipped';
  expected: TaxRegressionCase['expected'];
  actual?: RulepackCalculationResult;
  error?: string;
};

const BUILT_IN_RULEPACKS: InstallableTaxRulepack[] = [
  ...getBuiltInUSRulepacks(),
  ...getBuiltInEUTaxRulepacks(),
];

export async function getTaxRulepack(
  jurisdictionCode: string,
  options?: RulepackQueryOptions
): Promise<InstallableTaxRulepack | null> {
  const normalizedCode = jurisdictionCode.toUpperCase();
  const year = options?.year ?? new Date().getFullYear();
  const rows = await db.query<{
    id: string;
    country: string;
    jurisdiction_code: string;
    region: string;
    year: number;
    version: string;
    rules: unknown;
    filing_types: string[];
    status: TaxRulepackStatus;
    metadata: unknown;
    checksum: string | null;
    regression_summary: unknown;
    effective_from: Date;
    effective_to: Date | null;
    activated_at: Date | null;
    deprecated_at: Date | null;
    is_active: boolean;
  }>(
    `
      SELECT *
      FROM tax_rulepacks
      WHERE jurisdiction_code = $1
        AND year <= $2
        AND ($3::text IS NULL OR status = $3::text)
        AND ($4::boolean OR status IN ('active','pending'))
      ORDER BY year DESC, version DESC
      LIMIT 1
    `,
    [normalizedCode, year, options?.status ?? null, options?.includeInactive ?? false]
  );

  if (rows.rows.length > 0) {
    const dbRow = rows.rows[0]!;
    return mapRowToRulepack(dbRow);
  }

  const builtIn = findBuiltInRulepack(normalizedCode, year);
  if (builtIn) {
    logger.info('Falling back to built-in rulepack', {
      jurisdictionCode: normalizedCode,
      year,
      version: builtIn.version,
    });
    return builtIn;
  }

  return null;
}

export async function calculateTaxForJurisdiction(
  tenantId: TenantId,
  jurisdictionCode: string,
  transaction: RulepackTransactionInput,
  options?: RulepackQueryOptions
): Promise<RulepackCalculationResult> {
  const rulepack = await getTaxRulepack(jurisdictionCode, options);
  if (!rulepack) {
    throw new Error(`No tax rulepack available for jurisdiction ${jurisdictionCode}`);
  }

  const result = evaluateRulepackTransaction(rulepack, transaction);
  logger.info('Calculated jurisdictional tax', {
    tenantId,
    jurisdictionCode: rulepack.jurisdictionCode,
    amount: transaction.amount,
    taxAmount: result.taxAmount,
    ruleId: result.ruleId,
  });

  return result;
}

export async function calculateTaxForCountry(
  tenantId: TenantId,
  country: string,
  transaction: {
    amount: number;
    type: 'sale' | 'purchase' | 'income' | 'expense';
    category?: string;
  }
): Promise<RulepackCalculationResult> {
  const mappedTransaction: RulepackTransactionInput = {
    amount: transaction.amount,
    type: transaction.type === 'expense' ? 'purchase' : transaction.type,
    ...(transaction.category ? { category: transaction.category } : {}),
  };

  return calculateTaxForJurisdiction(tenantId, country, mappedTransaction);
}

export async function installTaxRulepack(
  rulepack: InstallableTaxRulepack,
  options?: { force?: boolean; targetStatus?: TaxRulepackStatus }
): Promise<{
  id: string;
  checksum: string;
  regressionSummary: TaxRegressionSummary;
  results: RegressionCaseResult[];
}> {
  const regression = await runRegressionSuite(rulepack);

  if (regression.summary.failed > 0 && !options?.force) {
    throw new Error(
      `Rulepack ${rulepack.jurisdictionCode} ${rulepack.version} failed regression (${regression.summary.failed} cases)`
    );
  }

  const metadataPayload = serializeMetadata(rulepack);
  const checksum = createHash('sha256')
    .update(JSON.stringify({ rules: rulepack.rules, metadata: metadataPayload }))
    .digest('hex');

  const status = options?.targetStatus ?? rulepack.status ?? 'active';
  const isActive = status === 'active';
  const activatedAt = isActive ? new Date() : rulepack.activatedAt || null;

  const rulepackId = await db.transaction(async client => {
    const insert = await client.query<{ id: string }>(
      `
        INSERT INTO tax_rulepacks (
          country,
          jurisdiction_code,
          region,
          year,
          version,
          rules,
          filing_types,
          status,
          metadata,
          checksum,
          regression_summary,
          effective_from,
          effective_to,
          activated_at,
          deprecated_at,
          is_active
        ) VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11::jsonb, $12, $13, $14, $15, $16
        )
        ON CONFLICT (jurisdiction_code, year, version)
        DO UPDATE SET
          rules = EXCLUDED.rules,
          filing_types = EXCLUDED.filing_types,
          status = EXCLUDED.status,
          metadata = EXCLUDED.metadata,
          checksum = EXCLUDED.checksum,
          regression_summary = EXCLUDED.regression_summary,
          effective_from = EXCLUDED.effective_from,
          effective_to = EXCLUDED.effective_to,
          activated_at = CASE WHEN EXCLUDED.is_active THEN NOW() ELSE tax_rulepacks.activated_at END,
          deprecated_at = CASE WHEN EXCLUDED.status = 'deprecated' THEN NOW() ELSE tax_rulepacks.deprecated_at END,
          is_active = EXCLUDED.is_active
        RETURNING id
      `,
      [
        rulepack.country,
        rulepack.jurisdictionCode,
        rulepack.region,
        rulepack.year,
        rulepack.version,
        JSON.stringify(rulepack.rules),
        rulepack.filingTypes,
        status,
        JSON.stringify(metadataPayload),
        checksum,
        JSON.stringify(regression.summary),
        rulepack.effectiveFrom,
        rulepack.effectiveTo ?? null,
        activatedAt,
        status === 'deprecated' ? new Date() : rulepack.deprecatedAt ?? null,
        isActive,
      ]
    );

    const persistedId = insert.rows[0]?.id;
    if (!persistedId) {
      throw new Error('Failed to persist rulepack (no id returned)');
    }

    if (rulepack.regressionTests && rulepack.regressionTests.length > 0) {
      for (const result of regression.results) {
        await client.query(
          `
            INSERT INTO rulepack_regressions (
              rulepack_id,
              case_id,
              description,
              input,
              expected,
              status,
              last_run_at,
              last_error
            ) VALUES (
              $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8
            )
            ON CONFLICT (rulepack_id, case_id)
            DO UPDATE SET
              description = EXCLUDED.description,
              input = EXCLUDED.input,
              expected = EXCLUDED.expected,
              status = EXCLUDED.status,
              last_run_at = EXCLUDED.last_run_at,
              last_error = EXCLUDED.last_error,
              updated_at = NOW()
          `,
          [
            persistedId,
            result.caseId,
            rulepack.regressionTests.find(c => c.id === result.caseId)?.description || result.caseId,
            JSON.stringify(rulepack.regressionTests.find(c => c.id === result.caseId)?.transaction ?? {}),
            JSON.stringify(result.expected),
            result.status,
            regression.summary.lastRunAt ?? new Date(),
            result.error || null,
          ]
        );
      }
    }

    return persistedId;
  });

  return {
    id: rulepackId,
    checksum,
    regressionSummary: regression.summary,
    results: regression.results,
  };
}

export async function runRegressionSuite(
  rulepack: InstallableTaxRulepack
): Promise<{ summary: TaxRegressionSummary; results: RegressionCaseResult[] }> {
  const cases = rulepack.regressionTests ?? [];
  if (cases.length === 0) {
    return {
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        lastRunAt: new Date(),
      },
      results: [],
    };
  }

  const results: RegressionCaseResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const testCase of cases) {
    try {
      const actual = evaluateRulepackTransaction(rulepack, testCase.transaction);
      const comparison = compareRegressionResult(actual, testCase);
      const entry: RegressionCaseResult = {
        caseId: testCase.id,
        status: comparison.passed ? 'pass' : 'fail',
        expected: testCase.expected,
      };
      entry.actual = actual;
      if (comparison.passed) {
        passed += 1;
      } else {
        failed += 1;
        if (comparison.error) {
          entry.error = comparison.error;
        }
      }
      results.push(entry);
    } catch (error) {
      failed += 1;
      const entry: RegressionCaseResult = {
        caseId: testCase.id,
        status: 'fail',
        expected: testCase.expected,
      };
      entry.error = error instanceof Error ? error.message : String(error);
      results.push(entry);
    }
  }

  return {
    summary: {
      total: cases.length,
      passed,
      failed,
      skipped: cases.length - (passed + failed),
      lastRunAt: new Date(),
    },
    results,
  };
}

function evaluateRulepackTransaction(
  rulepack: TaxRulepack,
  transaction: RulepackTransactionInput
): RulepackCalculationResult {
  const metadataRecord = (rulepack.metadata ?? {}) as Record<string, unknown>;
  const type = transaction.type;

  const incomeMetadata = metadataRecord.incomeTax as Record<string, unknown> | undefined;
  if ((type === 'income' || type === 'corporate_income') && incomeMetadata) {
    return calculateIncomeFromMetadata(rulepack, transaction, incomeMetadata);
  }

  const salesMetadata = metadataRecord.salesTax as Record<string, unknown> | undefined;
  if ((type === 'sale' || type === 'purchase') && salesMetadata) {
    return calculateSalesTaxFromMetadata(rulepack, transaction, salesMetadata);
  }

  const vatMetadata = metadataRecord.vat as Record<string, unknown> | undefined;
  if ((type === 'sale' || type === 'purchase') && vatMetadata) {
    return calculateVATFromMetadata(rulepack, transaction, vatMetadata);
  }

  // Fallback: apply first deterministic rule
  const fallbackRule = rulepack.rules[0];
  const rate = fallbackRule ? (fallbackRule as { rate?: number }).rate ?? 0 : 0;
  const taxAmount = round(transaction.amount * rate);

  return {
    taxRate: rate,
    taxAmount,
    ruleId: fallbackRule?.id ?? 'fallback',
    jurisdictionCode: rulepack.jurisdictionCode,
    rulepackVersion: rulepack.version,
  };
}

function calculateIncomeFromMetadata(
  rulepack: TaxRulepack,
  transaction: RulepackTransactionInput,
  incomeMetadata: Record<string, unknown>
): RulepackCalculationResult {
  const filingStatus = transaction.filingStatus || 'single';
  const brackets = normalizeBrackets(incomeMetadata.brackets, filingStatus);
  const standardDeductions =
    (incomeMetadata.standardDeductions as Record<string, number>) || (incomeMetadata.standardDeduction as Record<string, number>) || {};
  const deduction = standardDeductions[filingStatus] ?? 0;
  const totalDeductions = deduction + (transaction.deductions ?? 0);
  const taxableIncome = Math.max(0, transaction.amount - totalDeductions);
  let remaining = taxableIncome;
  let tax = 0;
  let previousMax = 0;

  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const upper = bracket.max ?? Number.MAX_SAFE_INTEGER;
    const span = Math.min(remaining, upper - previousMax);
    if (span > 0) {
      tax += span * bracket.rate;
      remaining -= span;
    }
    previousMax = upper;
  }

  tax = Math.max(0, tax - (transaction.credits ?? 0));

  const filingBoxes = projectFilingBoxes(rulepack, transaction, { taxableIncome, taxAmount: tax, amount: transaction.amount });
  const grossBase = transaction.amount === 0 ? 1 : transaction.amount;
  const effectiveRate = transaction.amount === 0 ? 0 : round(tax / grossBase, 4);

  return {
    taxRate: effectiveRate,
    taxAmount: round(tax),
    ruleId: rulepack.rules.find(r => r.id.includes('income'))?.id || 'income-metadata',
    jurisdictionCode: rulepack.jurisdictionCode,
    rulepackVersion: rulepack.version,
    ...(filingBoxes ? { filingBoxes } : {}),
    details: { taxableIncome: round(taxableIncome), deductions: round(totalDeductions) },
  };
}

function calculateSalesTaxFromMetadata(
  rulepack: TaxRulepack,
  transaction: RulepackTransactionInput,
  salesMetadata: Record<string, unknown>
): RulepackCalculationResult {
  const baseRate = (salesMetadata.baseRate as number) ?? 0;
  const localRates = (salesMetadata.localRates as Record<string, number>) || {};
  const locality = (transaction.metadata?.locality ||
    transaction.metadata?.localCode ||
    transaction.stateCode) as string | undefined;
  const category = (transaction.category || '').toLowerCase();
  const reducedCategories = ((salesMetadata.reducedCategories as string[]) || []).map(item => item.toLowerCase());

  let rate = baseRate;
  if (locality && localRates[locality]) {
    rate += localRates[locality];
  }
  if (category && reducedCategories.includes(category) && salesMetadata.reducedRate) {
    rate = salesMetadata.reducedRate as number;
  }

  const taxAmount = round(transaction.amount * rate);
  const filingBoxes = projectFilingBoxes(rulepack, transaction, { taxAmount, amount: transaction.amount });

  return {
    taxRate: rate,
    taxAmount,
    ruleId: rulepack.rules.find(r => r.id.includes('sales'))?.id || 'sales-metadata',
    jurisdictionCode: rulepack.jurisdictionCode,
    rulepackVersion: rulepack.version,
    ...(filingBoxes ? { filingBoxes } : {}),
  };
}

function calculateVATFromMetadata(
  rulepack: TaxRulepack,
  transaction: RulepackTransactionInput,
  vatMetadata: Record<string, unknown>
): RulepackCalculationResult {
  const category = (transaction.category || 'standard').toLowerCase();
  const standardRate = (vatMetadata.standardRate as number) ?? 0;
  const reducedRate = (vatMetadata.reducedRate as number) ?? standardRate;
  const zeroRateCategories = ((vatMetadata.zeroRateCategories as string[]) || []).map(v => v.toLowerCase());
  const reducedCategories = ((vatMetadata.reducedCategories as string[]) || ['reduced']).map(v => v.toLowerCase());

  let rate = standardRate;
  if (zeroRateCategories.includes(category) || category === 'zero' || category === 'exempt') {
    rate = 0;
  } else if (reducedCategories.includes(category)) {
    rate = reducedRate;
  }

  const taxAmount = round(transaction.amount * rate);
  const filingBoxes = projectFilingBoxes(rulepack, transaction, { taxAmount, amount: transaction.amount });

  return {
    taxRate: rate,
    taxAmount,
    ruleId: rulepack.rules.find(r => r.id.includes('vat'))?.id || 'vat-metadata',
    jurisdictionCode: rulepack.jurisdictionCode,
    rulepackVersion: rulepack.version,
    ...(filingBoxes ? { filingBoxes } : {}),
  };
}

function projectFilingBoxes(
  rulepack: TaxRulepack,
  transaction: RulepackTransactionInput,
  context: { amount: number; taxAmount: number; taxableIncome?: number }
): Record<string, number> | undefined {
  const schema = pickFilingSchema(rulepack, transaction.type);
  if (!schema) {
    return undefined;
  }

  const boxes: Record<string, number> = {};
  const metadata = (transaction.metadata ?? {}) as Record<string, unknown>;

  for (const box of schema.boxes) {
    const boxId = box.id;
    switch (box.calculation) {
      case 'amount':
        boxes[boxId] = round(context.amount);
        break;
      case 'taxAmount':
        boxes[boxId] = round(context.taxAmount);
        break;
      case 'taxableIncome':
        if (typeof context.taxableIncome === 'number') {
          boxes[boxId] = round(context.taxableIncome);
        }
        break;
      default:
        if (box.calculation?.startsWith('context.') && box.calculation.split('.').length === 2) {
          const key = box.calculation.split('.')[1] as string;
          const value = metadata[key];
          if (typeof value === 'number') {
            boxes[boxId] = round(value);
          }
        }
    }
  }

  return Object.keys(boxes).length ? boxes : undefined;
}

function compareRegressionResult(actual: RulepackCalculationResult, testCase: TaxRegressionCase): { passed: boolean; error?: string } {
  const tolerance = 0.01;
  const rateTolerance = 0.0001;

  if (Math.abs(actual.taxAmount - testCase.expected.taxAmount) > tolerance) {
    return {
      passed: false,
      error: `taxAmount mismatch expected ${testCase.expected.taxAmount} got ${actual.taxAmount}`,
    };
  }

  if (
    typeof testCase.expected.taxRate === 'number' &&
    Math.abs(actual.taxRate - testCase.expected.taxRate) > rateTolerance
  ) {
    return {
      passed: false,
      error: `taxRate mismatch expected ${testCase.expected.taxRate} got ${actual.taxRate}`,
    };
  }

  if (testCase.expected.filingBoxes) {
    const actualBoxes = actual.filingBoxes || {};
    for (const [boxId, expectedValue] of Object.entries(testCase.expected.filingBoxes)) {
      if (Math.abs((actualBoxes[boxId] ?? 0) - expectedValue) > tolerance) {
        return {
          passed: false,
          error: `filing box ${boxId} mismatch expected ${expectedValue} got ${actualBoxes[boxId] ?? 0}`,
        };
      }
    }
  }

  return { passed: true };
}

function mapRowToRulepack(row: {
  id: string;
  country: string;
  jurisdiction_code: string;
  region: string;
  year: number;
  version: string;
  rules: unknown;
  filing_types: string[];
  status: TaxRulepackStatus;
  metadata: unknown;
  checksum: string | null;
  regression_summary: unknown;
  effective_from: Date;
  effective_to: Date | null;
  activated_at: Date | null;
  deprecated_at: Date | null;
  is_active: boolean;
}): InstallableTaxRulepack {
  const metadata = deserializeMetadata(row.metadata as Record<string, unknown> | null);
  const mapped: InstallableTaxRulepack = {
    id: row.id,
    country: row.country,
    jurisdictionCode: row.jurisdiction_code,
    region: row.region,
    year: row.year,
    version: row.version,
    rules: (row.rules as TaxRulepack['rules']) || [],
    filingTypes: row.filing_types,
    status: row.status,
    metadata: metadata.metadata,
    effectiveFrom: row.effective_from,
    isActive: row.is_active,
  };

  if (metadata.filingSchemas && metadata.filingSchemas.length > 0) {
    mapped.filingSchemas = metadata.filingSchemas;
  }
  if (metadata.nexusThresholds && metadata.nexusThresholds.length > 0) {
    mapped.nexusThresholds = metadata.nexusThresholds;
  }
  if (row.checksum) {
    mapped.checksum = row.checksum;
  }
  if (row.regression_summary) {
    mapped.regressionSummary = row.regression_summary as TaxRegressionSummary;
  }
  if (row.effective_to) {
    mapped.effectiveTo = row.effective_to;
  }
  if (row.activated_at) {
    mapped.activatedAt = row.activated_at;
  }
  if (row.deprecated_at) {
    mapped.deprecatedAt = row.deprecated_at;
  }

  return mapped;
}

function serializeMetadata(rulepack: InstallableTaxRulepack): Record<string, unknown> {
  return {
    ...rulepack.metadata,
    __filingSchemas: rulepack.filingSchemas ?? [],
    __nexusThresholds: rulepack.nexusThresholds ?? [],
  };
}

function deserializeMetadata(metadata: Record<string, unknown> | null): {
  metadata: Record<string, unknown>;
  filingSchemas: TaxRulepack['filingSchemas'];
  nexusThresholds: TaxRulepack['nexusThresholds'];
} {
  if (!metadata) {
    return { metadata: {}, filingSchemas: undefined, nexusThresholds: undefined };
  }
  const cloned = { ...metadata };
  const filingSchemas = (cloned.__filingSchemas as TaxRulepack['filingSchemas']) || undefined;
  const nexusThresholds = (cloned.__nexusThresholds as TaxRulepack['nexusThresholds']) || undefined;
  delete cloned.__filingSchemas;
  delete cloned.__nexusThresholds;
  return { metadata: cloned, filingSchemas, nexusThresholds };
}

function findBuiltInRulepack(jurisdictionCode: string, year: number): InstallableTaxRulepack | undefined {
  const matches = BUILT_IN_RULEPACKS.filter(
    pack => pack.jurisdictionCode === jurisdictionCode && pack.year <= year
  ).sort((a, b) => b.year - a.year);
  return matches[0];
}

function normalizeBrackets(
  bracketsValue: unknown,
  filingStatus: string
): Array<{ min: number; max: number | null; rate: number }> {
  if (Array.isArray(bracketsValue)) {
    return bracketsValue as Array<{ min: number; max: number | null; rate: number }>;
  }
  if (bracketsValue && typeof bracketsValue === 'object') {
    const record = bracketsValue as Record<string, Array<{ min: number; max: number | null; rate: number }>>;
    return record[filingStatus] || record['single'] || [];
  }
  return [];
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function pickFilingSchema(rulepack: TaxRulepack, transactionType: RulepackTransactionInput['type']) {
  const schemas = rulepack.filingSchemas ?? [];
  if (schemas.length === 0) {
    return undefined;
  }

  const saleKeywords = ['vat', 'sales', 'gst', 'boe', 'ca3'];
  const incomeKeywords = ['1040', 'income', 'tax return', '540', 'corporation'];
  const keywords =
    transactionType === 'sale' || transactionType === 'purchase' ? saleKeywords : incomeKeywords;

  const match = schemas.find(schema =>
    keywords.some(keyword => schema.form.toLowerCase().includes(keyword))
  );

  return match ?? schemas[0];
}
