import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { validateTaxCalculation, ValidationResult } from './taxValidator';
import { checkDataAccuracy, AccuracyCheck } from './dataAccuracy';
import { detectAnomalies, Anomaly } from './anomalyDetector';
import {
  checkConfidenceThresholds,
  ConfidenceCheck,
  CRITICAL_CONFIDENCE_THRESHOLD,
} from './confidenceThreshold';

const logger = createLogger('validation-service');

type ValidationComponentType = 'tax' | 'accuracy' | 'anomalies' | 'confidence';

const INSERT_VALIDATION_RESULT = `
  INSERT INTO validation_results (
    tenant_id,
    entity_type,
    entity_id,
    validation_type,
    is_valid,
    errors,
    warnings,
    confidence,
    created_at
  )
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, NOW())
  RETURNING id
`;

const SEVERITY_RANK: Record<'none' | 'low' | 'medium' | 'high', number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const DEFAULT_PERIOD_DAYS = 90;

export interface ValidationSuiteOptions {
  tenantId: TenantId;
  entityType: string;
  entityId: string;
  filingType?: string;
  filingData?: Record<string, unknown>;
  periodStart?: Date;
  periodEnd?: Date;
  includeConfidenceChecks?: boolean;
}

export interface ValidationSuiteSummary {
  entityType: string;
  entityId: string;
  status: 'pass' | 'warning' | 'fail';
  errors: string[];
  warnings: string[];
  components: {
    tax?: ValidationResult | null;
    accuracy?: {
      checks: AccuracyCheck[];
      failed: AccuracyCheck[];
    };
    anomalies?: {
      items: Anomaly[];
      highestSeverity: 'none' | 'low' | 'medium' | 'high';
    };
    confidence?: {
      checks: ConfidenceCheck[];
      requiresReview: ConfidenceCheck[];
    };
  };
  recordsPersisted: Partial<Record<ValidationComponentType, string | null>>;
  metadata: {
    periodStart: string;
    periodEnd: string;
    startedAt: string;
    completedAt: string;
  };
}

interface PersistParams {
  tenantId: TenantId;
  entityType: string;
  entityId: string;
  component: ValidationComponentType;
  isValid: boolean;
  errors?: string[];
  warnings?: string[];
  confidence?: number | null;
}

function resolvePeriod(periodStart?: Date, periodEnd?: Date): { start: Date; end: Date } {
  if (periodStart && periodEnd) {
    return { start: periodStart, end: periodEnd };
  }

  const end = periodEnd ?? new Date();
  const start = periodStart ?? new Date(end);
  start.setDate(start.getDate() - DEFAULT_PERIOD_DAYS);
  return { start, end };
}

function highestSeverity(anomalies: Anomaly[]): 'none' | 'low' | 'medium' | 'high' {
  if (!anomalies.length) {
    return 'none';
  }

  return anomalies.reduce<'none' | 'low' | 'medium' | 'high'>((current, item) => {
    const candidate = item.severity;
    return SEVERITY_RANK[candidate] > SEVERITY_RANK[current] ? candidate : current;
  }, 'none');
}

async function persistComponent(params: PersistParams): Promise<string | null> {
  try {
    const result = await db.query<{ id: string }>(INSERT_VALIDATION_RESULT, [
      params.tenantId,
      params.entityType,
      params.entityId,
      params.component,
      params.isValid,
      JSON.stringify(params.errors ?? []),
      JSON.stringify(params.warnings ?? []),
      params.confidence ?? null,
    ]);
    return result.rows[0]?.id ?? null;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to persist validation result', err, {
        component: params.component,
        entityId: params.entityId,
      });
    return null;
  }
}

export async function runValidationSuite(options: ValidationSuiteOptions): Promise<ValidationSuiteSummary> {
  if (!options.entityType || !options.entityId) {
    throw new Error('entityType and entityId are required for validation suite');
  }

  const { tenantId, entityId, entityType } = options;
  const includeConfidence = options.includeConfidenceChecks !== false;
  const { start: periodStart, end: periodEnd } = resolvePeriod(options.periodStart, options.periodEnd);
  const startedAt = new Date();

  const overallErrors: string[] = [];
  const overallWarnings: string[] = [];
  const recordsPersisted: Partial<Record<ValidationComponentType, string | null>> = {};

  let taxResult: ValidationResult | null = null;
  if (options.filingType && options.filingData) {
    try {
      taxResult = await validateTaxCalculation(tenantId, options.filingType, options.filingData);
      recordsPersisted.tax = await persistComponent({
        tenantId,
        entityType,
        entityId,
        component: 'tax',
        isValid: taxResult.isValid,
        errors: taxResult.errors,
        warnings: taxResult.warnings,
        confidence: taxResult.confidence,
      });

      if (!taxResult.isValid) {
        overallErrors.push('Tax validation failed');
      } else if (taxResult.warnings.length) {
        overallWarnings.push('Tax validation produced warnings');
      }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Tax validation execution failed', err, { entityId });
      overallErrors.push('Tax validation could not be executed');
      recordsPersisted.tax = await persistComponent({
        tenantId,
        entityType,
        entityId,
        component: 'tax',
        isValid: false,
        errors: ['Tax validation execution error'],
      });
    }
  }

  let accuracyChecks: AccuracyCheck[] = [];
  try {
    accuracyChecks = await checkDataAccuracy(tenantId, periodStart, periodEnd);
    const failedChecks = accuracyChecks.filter(check => !check.passed);
    recordsPersisted.accuracy = await persistComponent({
      tenantId,
      entityType,
      entityId,
      component: 'accuracy',
      isValid: failedChecks.length === 0,
      errors: failedChecks.map(check => `${check.check}: ${check.message}`),
    });
    if (failedChecks.length) {
      overallErrors.push('Data accuracy checks failed');
    }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Accuracy check execution failed', err, { entityId });
    overallErrors.push('Accuracy checks could not be executed');
    recordsPersisted.accuracy = await persistComponent({
      tenantId,
      entityType,
      entityId,
      component: 'accuracy',
      isValid: false,
      errors: ['Accuracy check execution error'],
    });
  }

  let anomalyItems: Anomaly[] = [];
  try {
    anomalyItems = await detectAnomalies(tenantId, periodStart, periodEnd);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Anomaly detection execution failed', err, { entityId });
    overallWarnings.push('Anomaly detection could not be executed');
  }

  const anomalySeverity = highestSeverity(anomalyItems);
  recordsPersisted.anomalies = await persistComponent({
    tenantId,
    entityType,
    entityId,
    component: 'anomalies',
    isValid: anomalySeverity !== 'high',
    errors: anomalySeverity === 'high' ? ['High severity anomalies detected'] : [],
    warnings: anomalySeverity === 'medium' ? ['Medium severity anomalies detected'] : [],
  });

  if (anomalySeverity === 'high') {
    overallErrors.push('High severity anomalies detected');
  } else if (anomalySeverity === 'medium') {
    overallWarnings.push('Medium severity anomalies detected');
  } else if (anomalyItems.length) {
    overallWarnings.push('Low severity anomalies detected');
  }

  let confidenceChecks: ConfidenceCheck[] = [];
  if (includeConfidence) {
    try {
      confidenceChecks = await checkConfidenceThresholds(tenantId);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Confidence check execution failed', err, { entityId });
      overallWarnings.push('Confidence checks could not be executed');
    }
  }

  const confidenceFailures = confidenceChecks.filter(check => check.requiresReview);
  const criticalConfidence = confidenceFailures.filter(
    check => check.confidenceScore < CRITICAL_CONFIDENCE_THRESHOLD
  );

  if (includeConfidence) {
    recordsPersisted.confidence = await persistComponent({
      tenantId,
      entityType,
      entityId,
      component: 'confidence',
      isValid: confidenceFailures.length === 0,
      errors: criticalConfidence.length ? ['Critical confidence issues detected'] : [],
      warnings:
        !criticalConfidence.length && confidenceFailures.length
          ? ['Documents require manual review due to confidence']
          : [],
      confidence:
        confidenceChecks.length > 0
          ? confidenceChecks.reduce((sum, check) => sum + check.confidenceScore, 0) /
            confidenceChecks.length
          : null,
    });
  }

  if (criticalConfidence.length) {
    overallErrors.push('Critical confidence issues detected');
  } else if (confidenceFailures.length) {
    overallWarnings.push('Some documents require manual review due to confidence');
  }

  let status: 'pass' | 'warning' | 'fail' = 'pass';
  if (overallErrors.length) {
    status = 'fail';
  } else if (overallWarnings.length) {
    status = 'warning';
  }

  const completedAt = new Date();

  return {
    entityType,
    entityId,
    status,
    errors: overallErrors,
    warnings: overallWarnings,
    components: {
      tax: taxResult ?? undefined,
      accuracy: {
        checks: accuracyChecks,
        failed: accuracyChecks.filter(check => !check.passed),
      },
      anomalies: {
        items: anomalyItems,
        highestSeverity: anomalySeverity,
      },
      confidence: includeConfidence
        ? {
            checks: confidenceChecks,
            requiresReview: confidenceFailures,
          }
        : undefined,
    },
    recordsPersisted,
    metadata: {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    },
  };
}
