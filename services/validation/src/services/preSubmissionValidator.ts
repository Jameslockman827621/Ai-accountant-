import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { crossValidateData } from './crossValidationEngine';
import { verifyTaxCalculation } from './taxCalculationVerifier';
import { checkDataAccuracy } from './dataAccuracy';
import { detectAnomaliesML } from './anomalyDetectionService';

const logger = createLogger('validation-service');

export interface PreSubmissionCheck {
  check: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  message: string;
  details?: Record<string, unknown>;
  required: boolean; // If true, filing cannot proceed if this fails
}

export interface PreSubmissionValidationResult {
  filingId: string;
  filingType: string;
  periodStart: Date;
  periodEnd: Date;
  canProceed: boolean;
  checks: PreSubmissionCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    errors: number;
  };
}

/**
 * Comprehensive pre-submission validation checklist
 * Ensures all requirements are met before filing submission
 */
export async function validatePreSubmission(
  tenantId: TenantId,
  filingId: string
): Promise<PreSubmissionValidationResult> {
  logger.info('Running pre-submission validation', { tenantId, filingId });

  // Get filing details
  const filingResult = await db.query<{
    id: string;
    filing_type: string;
    period_start: Date;
    period_end: Date;
    status: string;
    filing_data: Record<string, unknown>;
  }>(
    `SELECT id, filing_type, period_start, period_end, status, filing_data
     FROM filings
     WHERE id = $1 AND tenant_id = $2`,
    [filingId, tenantId]
  );

  if (filingResult.rows.length === 0) {
    throw new Error('Filing not found');
  }

  const filing = filingResult.rows[0];
  const checks: PreSubmissionCheck[] = [];

  // Check 1: Filing status
  checks.push({
    check: 'Filing Status',
    passed: filing.status === 'pending_approval' || filing.status === 'draft',
    severity: 'error',
    message: filing.status === 'submitted' 
      ? 'Filing has already been submitted'
      : filing.status === 'accepted'
      ? 'Filing has already been accepted'
      : 'Filing is ready for submission',
    required: true,
  });

  // Check 2: Data accuracy
  const accuracyChecks = await checkDataAccuracy(
    tenantId,
    filing.period_start,
    filing.period_end
  );

  const accuracyPassed = accuracyChecks.every(c => c.passed);
  checks.push({
    check: 'Data Accuracy',
    passed: accuracyPassed,
    severity: accuracyPassed ? 'info' : 'error',
    message: accuracyPassed
      ? 'All data accuracy checks passed'
      : `${accuracyChecks.filter(c => !c.passed).length} data accuracy checks failed`,
    details: { checks: accuracyChecks },
    required: true,
  });

  // Check 3: Cross-validation
  const crossValidation = await crossValidateData(
    tenantId,
    filing.period_start,
    filing.period_end
  );

  const matchRateThreshold = 0.85; // 85% match rate required
  const crossValidationPassed = crossValidation.summary.matchRate >= matchRateThreshold;
  checks.push({
    check: 'Cross-Validation',
    passed: crossValidationPassed,
    severity: crossValidationPassed ? 'info' : 'warning',
    message: `Match rate: ${(crossValidation.summary.matchRate * 100).toFixed(1)}% (${crossValidation.unmatchedItems} unmatched items)`,
    details: {
      matchRate: crossValidation.summary.matchRate,
      unmatchedItems: crossValidation.unmatchedItems,
      discrepancies: crossValidation.discrepancies.length,
    },
    required: false, // Warning but not blocking
  });

  // Check 4: Tax calculation verification
  try {
    const taxVerification = await verifyTaxCalculation(
      tenantId,
      filing.filing_type as 'vat' | 'paye' | 'corporation_tax',
      filing.period_start,
      filing.period_end
    );

    checks.push({
      check: 'Tax Calculation Verification',
      passed: taxVerification.verified,
      severity: taxVerification.verified ? 'info' : 'error',
      message: taxVerification.verified
        ? 'Tax calculations verified against HMRC rules'
        : `${taxVerification.discrepancies.length} calculation discrepancies found`,
      details: {
        discrepancies: taxVerification.discrepancies,
        warnings: taxVerification.warnings,
      },
      required: true,
    });
  } catch (error) {
    checks.push({
      check: 'Tax Calculation Verification',
      passed: false,
      severity: 'warning',
      message: `Could not verify tax calculation: ${error instanceof Error ? error.message : 'Unknown error'}`,
      required: false,
    });
  }

  // Check 5: Anomaly detection
  const anomalies = await detectAnomaliesML(
    tenantId,
    filing.period_start,
    filing.period_end
  );

  const criticalAnomalies = anomalies.anomalies.filter(a => a.severity === 'critical' || a.severity === 'high');
  checks.push({
    check: 'Anomaly Detection',
    passed: criticalAnomalies.length === 0,
    severity: criticalAnomalies.length === 0 ? 'info' : 'warning',
    message: criticalAnomalies.length === 0
      ? 'No critical anomalies detected'
      : `${criticalAnomalies.length} critical/high severity anomalies found`,
    details: {
      totalAnomalies: anomalies.totalAnomalies,
      criticalAnomalies: criticalAnomalies.length,
      summary: anomalies.summary,
    },
    required: false, // Warning but not blocking
  });

  // Check 6: Required fields
  const requiredFields: Record<string, string[]> = {
    vat: ['vatOutput', 'vatInput', 'vatNet'],
    paye: ['totalPAYE', 'employeeCount'],
    corporation_tax: ['profit', 'corporationTax'],
  };

  const fields = requiredFields[filing.filing_type as keyof typeof requiredFields] || [];
  const missingFields = fields.filter(
    field => !(filing.filing_data[field] || filing.filing_data[field.toLowerCase()])
  );

  checks.push({
    check: 'Required Fields',
    passed: missingFields.length === 0,
    severity: missingFields.length === 0 ? 'info' : 'error',
    message: missingFields.length === 0
      ? 'All required fields present'
      : `Missing required fields: ${missingFields.join(', ')}`,
    details: { missingFields },
    required: true,
  });

  // Check 7: Filing attestation (if required)
  const attestationResult = await db.query<{
    count: number;
  }>(
    `SELECT COUNT(*) as count
     FROM filing_attestations
     WHERE filing_id = $1`,
    [filingId]
  );

  const hasAttestation = parseInt(String(attestationResult.rows[0]?.count || 0), 10) > 0;
  checks.push({
    check: 'Filing Attestation',
    passed: hasAttestation,
    severity: hasAttestation ? 'info' : 'warning',
    message: hasAttestation
      ? 'Filing has been attested'
      : 'Filing attestation recommended before submission',
    required: false, // Recommended but not always required
  });

  // Check 8: Review workflow (if required)
  const reviewResult = await db.query<{
    status: string;
  }>(
    `SELECT status
     FROM filing_reviews
     WHERE filing_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [filingId]
  );

  const hasApproval = reviewResult.rows.length > 0 && reviewResult.rows[0].status === 'approved';
  checks.push({
    check: 'Review Approval',
    passed: hasApproval,
    severity: hasApproval ? 'info' : 'warning',
    message: hasApproval
      ? 'Filing has been reviewed and approved'
      : 'Filing review and approval recommended before submission',
    required: false, // Recommended but not always required
  });

  // Summary
  const summary = {
    total: checks.length,
    passed: checks.filter(c => c.passed).length,
    failed: checks.filter(c => !c.passed).length,
    warnings: checks.filter(c => c.severity === 'warning').length,
    errors: checks.filter(c => c.severity === 'error').length,
  };

  // Can proceed if all required checks pass
  const requiredChecks = checks.filter(c => c.required);
  const canProceed = requiredChecks.every(c => c.passed);

  return {
    filingId,
    filingType: filing.filing_type,
    periodStart: filing.period_start,
    periodEnd: filing.period_end,
    canProceed,
    checks,
    summary,
  };
}
