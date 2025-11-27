import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, FilingId } from '@ai-accountant/shared-types';
import { validateVATNumberRealTime, validateCorporationTaxSubmission } from '../../compliance/src/services/hmrcRealTimeValidation';
import { validateTaxCalculation } from '../../validation/src/services/taxValidator';
import { checkDataAccuracy } from '../../validation/src/services/dataAccuracy';
import { detectAnomalies } from '../../validation/src/services/anomalyDetector';
import { rulepackManager } from '../../../rules-engine/src/services/rulepackDSL';
import { authorityAdapterRegistry } from './authorityAdapters';

const logger = createLogger('filing-service');

export interface PreSubmissionValidation {
  filingId: FilingId;
  isValid: boolean;
  errors: string[];
  warnings: string[];
  checks: Array<{
    check: string;
    passed: boolean;
    message: string;
    severity: 'error' | 'warning' | 'info';
    required?: boolean;
  }>;
  confidence: number;
}

/**
 * Comprehensive pre-submission validation
 */
export async function validateFilingPreSubmission(
  tenantId: TenantId,
  filingId: FilingId
): Promise<PreSubmissionValidation> {
  logger.info('Validating filing pre-submission', { tenantId, filingId });

  const filing = await db.query<{
    filing_type: string;
    filing_data: Record<string, unknown>;
    period_start: Date;
    period_end: Date;
    status: string;
  }>(
    'SELECT filing_type, filing_data, period_start, period_end, status FROM filings WHERE id = $1 AND tenant_id = $2',
    [filingId, tenantId]
  );

  if (filing.rows.length === 0) {
    throw new Error('Filing not found');
  }

  const filingData = filing.rows[0];
  const checks: PreSubmissionValidation['checks'] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Tax calculation validation
  const taxValidation = await validateTaxCalculation(
    tenantId,
    filingData.filing_type,
    filingData.filing_data
  );
  checks.push({
    check: 'Tax Calculation',
    passed: taxValidation.isValid,
    message: taxValidation.isValid ? 'Tax calculation is valid' : taxValidation.errors.join(', '),
    severity: taxValidation.isValid ? 'info' : 'error',
  });
  if (!taxValidation.isValid) {
    errors.push(...taxValidation.errors);
  }
  warnings.push(...taxValidation.warnings);

  const jurisdictionResult = await db.query<{ jurisdiction: string | null }>(
    `SELECT jurisdiction
       FROM intent_profiles
      WHERE tenant_id = $1
      LIMIT 1`,
    [tenantId]
  );
  const jurisdiction = jurisdictionResult.rows[0]?.jurisdiction || 'GB';

  try {
    const rulepack = await rulepackManager.getActiveRulepack(
      jurisdiction,
      filingData.filing_type,
      filingData.period_end
    );

    if (!rulepack) {
      checks.push({
        check: 'Jurisdiction Rulepack',
        passed: false,
        required: true,
        message: `No active rulepack found for ${jurisdiction}`,
        severity: 'error',
      });
      errors.push(`No active rulepack found for ${jurisdiction}`);
    } else {
      const evaluation = await rulepackManager.evaluateForFiling(jurisdiction, filingData.filing_type, {
        tenantId,
        periodStart: filingData.period_start.toISOString(),
        periodEnd: filingData.period_end.toISOString(),
        data: filingData.filing_data,
      });
      checks.push({
        check: 'Jurisdiction Rulepack',
        passed: true,
        required: true,
        message: `Rulepack ${rulepack['version'] || 'active'} validated`,
        severity: 'info',
      });

      if (evaluation.flags.length > 0) {
        warnings.push(...evaluation.flags);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Rulepack evaluation failed';
    checks.push({
      check: 'Jurisdiction Rulepack',
      passed: false,
      required: true,
      message,
      severity: 'error',
    });
    errors.push(message);
  }

  // 2. Data accuracy check
  const accuracyChecks = await checkDataAccuracy(
    tenantId,
    filingData.period_start,
    filingData.period_end
  );
  accuracyChecks.forEach(check => {
    checks.push({
      check: check.check,
      passed: check.passed,
      message: check.message,
      severity: check.passed ? 'info' : 'warning',
    });
    if (!check.passed) {
      warnings.push(check.message);
    }
  });

  // 3. Anomaly detection
  const anomalies = await detectAnomalies(
    tenantId,
    filingData.period_start,
    filingData.period_end
  );
  anomalies.forEach(anomaly => {
    checks.push({
      check: 'Anomaly Detection',
      passed: anomaly.severity === 'low',
      message: anomaly.description,
      severity: anomaly.severity === 'high' ? 'error' : anomaly.severity === 'medium' ? 'warning' : 'info',
    });
    if (anomaly.severity === 'high') {
      errors.push(anomaly.description);
    } else if (anomaly.severity === 'medium') {
      warnings.push(anomaly.description);
    }
  });

  // 4. HMRC real-time validation
  if (filingData.filing_type === 'vat') {
    const vatNumber = filingData.filing_data.vatNumber as string | undefined;
    if (vatNumber) {
      const hmrcValidation = await validateVATNumberRealTime(tenantId, vatNumber);
      checks.push({
        check: 'HMRC VAT Validation',
        passed: hmrcValidation.isValid,
        message: hmrcValidation.isValid ? 'VAT number validated' : hmrcValidation.errors.join(', '),
        severity: hmrcValidation.isValid ? 'info' : 'error',
      });
      if (!hmrcValidation.isValid) {
        errors.push(...hmrcValidation.errors);
      }
    }
  } else if (filingData.filing_type === 'corporation_tax') {
    const ctValidation = await validateCorporationTaxSubmission(tenantId, filingData.filing_data);
    checks.push({
      check: 'HMRC CT Validation',
      passed: ctValidation.isValid,
      message: ctValidation.isValid ? 'CT return validated' : ctValidation.errors.join(', '),
      severity: ctValidation.isValid ? 'info' : 'error',
    });
    if (!ctValidation.isValid) {
      errors.push(...ctValidation.errors);
    }
  }

  // 5. Required fields check
  const requiredFields = getRequiredFields(filingData.filing_type);
  requiredFields.forEach(field => {
    if (!filingData.filing_data[field]) {
      checks.push({
        check: 'Required Fields',
        passed: false,
        message: `Missing required field: ${field}`,
        severity: 'error',
      });
      errors.push(`Missing required field: ${field}`);
    }
  });

  const adapterContext = {
    filingId,
    tenantId,
    filingType: filingData.filing_type,
    jurisdiction,
    payload: filingData.filing_data,
  };

  const adapter = authorityAdapterRegistry.findSupportingAdapter(adapterContext);
  checks.push({
    check: 'E-filing Adapter',
    passed: Boolean(adapter),
    required: true,
    message: adapter ? `Adapter ${adapter.id} available` : 'No adapter available for jurisdiction',
    severity: adapter ? 'info' : 'error',
  });
  if (!adapter) {
    errors.push('No e-filing adapter available for jurisdiction');
  }

  const isValid = errors.length === 0;
  const confidence = isValid && warnings.length === 0 ? 0.95 :
    isValid ? 0.85 :
    warnings.length === 0 ? 0.60 : 0.50;

  await db.query(
    `INSERT INTO validation_results (
        tenant_id,
        entity_type,
        entity_id,
        validation_type,
        is_valid,
        errors,
        warnings,
        confidence
      ) VALUES ($1, 'filing', $2, 'pre_submission', $3, $4::jsonb, $5::jsonb, $6)
      ON CONFLICT (tenant_id, entity_id, validation_type)
      DO UPDATE SET
        is_valid = EXCLUDED.is_valid,
        errors = EXCLUDED.errors,
        warnings = EXCLUDED.warnings,
        confidence = EXCLUDED.confidence,
        created_at = NOW()`,
    [tenantId, filingId, isValid, JSON.stringify(errors), JSON.stringify(warnings), confidence]
  );

  return {
    filingId,
    isValid,
    errors,
    warnings,
    checks,
    confidence,
  };
}

function getRequiredFields(filingType: string): string[] {
  switch (filingType) {
    case 'vat':
      return ['periodStart', 'periodEnd', 'totalVatDue', 'netVatDue'];
    case 'corporation_tax':
      return ['periodStart', 'periodEnd', 'profitBeforeTax', 'corporationTax'];
    case 'paye':
      return ['periodStart', 'periodEnd', 'grossPay', 'netPay'];
    default:
      return [];
  }
}
