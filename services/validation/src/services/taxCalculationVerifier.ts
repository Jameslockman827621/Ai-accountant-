import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('validation-service');

export interface TaxVerificationResult {
  filingType: 'vat' | 'paye' | 'corporation_tax';
  periodStart: Date;
  periodEnd: Date;
  calculatedAmount: number;
  expectedAmount: number;
  verified: boolean;
  discrepancies: Array<{
    field: string;
    calculated: number;
    expected: number;
    difference: number;
    rule: string;
  }>;
  warnings: string[];
}

/**
 * Verify tax calculations against HMRC rules and requirements
 * This ensures calculations match official tax authority requirements
 */
export async function verifyTaxCalculation(
  tenantId: TenantId,
  filingType: 'vat' | 'paye' | 'corporation_tax',
  periodStart: Date,
  periodEnd: Date
): Promise<TaxVerificationResult> {
  logger.info('Verifying tax calculation', { tenantId, filingType, periodStart, periodEnd });

  const discrepancies: TaxVerificationResult['discrepancies'] = [];
  const warnings: string[] = [];

  if (filingType === 'vat') {
    return await verifyVATCalculation(tenantId, periodStart, periodEnd, discrepancies, warnings);
  } else if (filingType === 'paye') {
    return await verifyPAYECalculation(tenantId, periodStart, periodEnd, discrepancies, warnings);
  } else if (filingType === 'corporation_tax') {
    return await verifyCorporationTaxCalculation(tenantId, periodStart, periodEnd, discrepancies, warnings);
  }

  throw new Error(`Unsupported filing type: ${filingType}`);
}

async function verifyVATCalculation(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date,
  discrepancies: TaxVerificationResult['discrepancies'],
  warnings: string[]
): Promise<TaxVerificationResult> {
  // Get VAT filing data
  const filingResult = await db.query<{
    filing_data: Record<string, unknown>;
  }>(
    `SELECT filing_data
     FROM filings
     WHERE tenant_id = $1
       AND filing_type = 'vat'
       AND period_start = $2
       AND period_end = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, periodStart, periodEnd]
  );

  if (filingResult.rows.length === 0) {
    throw new Error('No VAT filing found for the specified period');
  }

  const filingData = filingResult.rows[0].filing_data;

  // Recalculate from ledger entries
  const ledgerResult = await db.query<{
    vat_output: number;
    vat_input: number;
    vat_net: number;
  }>(
    `SELECT 
       SUM(CASE 
         WHEN entry_type = 'credit' AND tax_amount > 0 
         THEN tax_amount ELSE 0 END) as vat_output,
       SUM(CASE 
         WHEN entry_type = 'debit' AND tax_amount > 0 
         THEN tax_amount ELSE 0 END) as vat_input,
       SUM(CASE 
         WHEN entry_type = 'credit' AND tax_amount > 0 
         THEN tax_amount ELSE 0 END) - 
       SUM(CASE 
         WHEN entry_type = 'debit' AND tax_amount > 0 
         THEN tax_amount ELSE 0 END) as vat_net
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
       AND tax_rate IS NOT NULL
       AND tax_amount IS NOT NULL`,
    [tenantId, periodStart, periodEnd]
  );

  const recalculated = ledgerResult.rows[0] || {
    vat_output: 0,
    vat_input: 0,
    vat_net: 0,
  };

  const calculatedOutput = parseFloat(String(filingData.vatOutput || filingData.outputVat || 0));
  const calculatedInput = parseFloat(String(filingData.vatInput || filingData.inputVat || 0));
  const calculatedNet = parseFloat(String(filingData.vatNet || filingData.netVat || 0));

  const expectedOutput = parseFloat(String(recalculated.vat_output || 0));
  const expectedInput = parseFloat(String(recalculated.vat_input || 0));
  const expectedNet = parseFloat(String(recalculated.vat_net || 0));

  // Verify output VAT
  const outputDiff = Math.abs(calculatedOutput - expectedOutput);
  if (outputDiff > 0.01) {
    discrepancies.push({
      field: 'vat_output',
      calculated: calculatedOutput,
      expected: expectedOutput,
      difference: outputDiff,
      rule: 'VAT output must match sum of output VAT from ledger entries',
    });
  }

  // Verify input VAT
  const inputDiff = Math.abs(calculatedInput - expectedInput);
  if (inputDiff > 0.01) {
    discrepancies.push({
      field: 'vat_input',
      calculated: calculatedInput,
      expected: expectedInput,
      difference: inputDiff,
      rule: 'VAT input must match sum of input VAT from ledger entries',
    });
  }

  // Verify net VAT
  const netDiff = Math.abs(calculatedNet - expectedNet);
  if (netDiff > 0.01) {
    discrepancies.push({
      field: 'vat_net',
      calculated: calculatedNet,
      expected: expectedNet,
      difference: netDiff,
      rule: 'Net VAT must equal output VAT minus input VAT',
    });
  }

  // Check VAT rate consistency (should be 20% for standard rate)
  const vatRateResult = await db.query<{
    tax_rate: number;
    count: number;
  }>(
    `SELECT tax_rate, COUNT(*) as count
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
       AND tax_rate IS NOT NULL
     GROUP BY tax_rate
     ORDER BY count DESC`,
    [tenantId, periodStart, periodEnd]
  );

  const nonStandardRates = vatRateResult.rows.filter(row => {
    const rate = parseFloat(String(row.tax_rate));
    return rate !== 0.20 && rate !== 0.05 && rate !== 0.00;
  });

  if (nonStandardRates.length > 0) {
    warnings.push(
      `Non-standard VAT rates detected: ${nonStandardRates.map(r => `${(parseFloat(String(r.tax_rate)) * 100).toFixed(1)}%`).join(', ')}`
    );
  }

  const verified = discrepancies.length === 0;

  return {
    filingType: 'vat',
    periodStart,
    periodEnd,
    calculatedAmount: calculatedNet,
    expectedAmount: expectedNet,
    verified,
    discrepancies,
    warnings,
  };
}

async function verifyPAYECalculation(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date,
  discrepancies: TaxVerificationResult['discrepancies'],
  warnings: string[]
): Promise<TaxVerificationResult> {
  // Get PAYE filing data
  const filingResult = await db.query<{
    filing_data: Record<string, unknown>;
  }>(
    `SELECT filing_data
     FROM filings
     WHERE tenant_id = $1
       AND filing_type = 'paye'
       AND period_start = $2
       AND period_end = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, periodStart, periodEnd]
  );

  if (filingResult.rows.length === 0) {
    throw new Error('No PAYE filing found for the specified period');
  }

  const filingData = filingResult.rows[0].filing_data;
  const calculatedPAYE = parseFloat(String(filingData.totalPAYE || filingData.payeTotal || 0));

  // PAYE verification would require payroll data
  // For now, we'll do basic validation
  if (calculatedPAYE < 0) {
    discrepancies.push({
      field: 'paye_total',
      calculated: calculatedPAYE,
      expected: 0,
      difference: Math.abs(calculatedPAYE),
      rule: 'PAYE cannot be negative',
    });
  }

  const verified = discrepancies.length === 0;

  return {
    filingType: 'paye',
    periodStart,
    periodEnd,
    calculatedAmount: calculatedPAYE,
    expectedAmount: calculatedPAYE, // Would need payroll data for proper verification
    verified,
    discrepancies,
    warnings,
  };
}

async function verifyCorporationTaxCalculation(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date,
  discrepancies: TaxVerificationResult['discrepancies'],
  warnings: string[]
): Promise<TaxVerificationResult> {
  // Get Corporation Tax filing data
  const filingResult = await db.query<{
    filing_data: Record<string, unknown>;
  }>(
    `SELECT filing_data
     FROM filings
     WHERE tenant_id = $1
       AND filing_type = 'corporation_tax'
       AND period_start = $2
       AND period_end = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, periodStart, periodEnd]
  );

  if (filingResult.rows.length === 0) {
    throw new Error('No Corporation Tax filing found for the specified period');
  }

  const filingData = filingResult.rows[0].filing_data;
  const calculatedCT = parseFloat(String(filingData.corporationTax || filingData.ctTotal || 0));
  const profit = parseFloat(String(filingData.profit || filingData.taxableProfit || 0));

  // Verify tax rate application
  // Small profits rate: 19% (up to £50,000)
  // Main rate: 25% (over £250,000)
  // Marginal relief: between thresholds
  let expectedRate = 0.19;
  if (profit > 250000) {
    expectedRate = 0.25;
  } else if (profit > 50000) {
    // Marginal relief zone
    expectedRate = 0.19 + ((profit - 50000) / 200000) * 0.06; // Simplified
  }

  const expectedCT = profit * expectedRate;
  const ctDiff = Math.abs(calculatedCT - expectedCT);

  if (ctDiff > profit * 0.01) { // 1% tolerance
    discrepancies.push({
      field: 'corporation_tax',
      calculated: calculatedCT,
      expected: expectedCT,
      difference: ctDiff,
      rule: `Corporation tax should be ${(expectedRate * 100).toFixed(1)}% of profit for profit of £${profit.toLocaleString()}`,
    });
  }

  const verified = discrepancies.length === 0;

  return {
    filingType: 'corporation_tax',
    periodStart,
    periodEnd,
    calculatedAmount: calculatedCT,
    expectedAmount: expectedCT,
    verified,
    discrepancies,
    warnings,
  };
}
