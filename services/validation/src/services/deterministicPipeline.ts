import { createLogger } from '@ai-accountant/shared-utils';
import {
  TenantId,
  UserId,
  ValidationAuditEvent,
  ValidationDecision,
  ValidationDomain,
  ValidationOverride,
  ValidationRejection,
  ValidationRunSummary,
  ValidationStatus,
} from '@ai-accountant/shared-types';
import { executableRulePacks, RuleEvaluation } from './rulePacks';
import {
  completeValidationRun,
  recordAuditEvent,
  recordRejection,
  recordValidationComponent,
  recordValidationDecision,
  recordValidationOverride,
  startValidationRun,
} from './validationRunStore';

const logger = createLogger('validation-pipeline');

export interface ValidationPayload {
  banking?: { transactions: Array<Record<string, unknown>> };
  payroll?: { runs: Array<Record<string, unknown>> };
  ap_ar?: { invoices: Array<Record<string, unknown>> };
  tax?: { filings: Array<Record<string, unknown>>; regressionCases?: Array<Record<string, unknown>> };
}

export interface DeterministicRunInput {
  tenantId: TenantId;
  entityType: string;
  entityId: string;
  payload: ValidationPayload;
  triggeredBy?: UserId;
}

export interface DeterministicRunResult {
  run: ValidationRunSummary;
  rejections: ValidationRejection[];
  overrides: ValidationOverride[];
  auditTrail: ValidationAuditEvent[];
}

function mapStatus(evaluations: RuleEvaluation[]): ValidationStatus {
  if (evaluations.some(evaluation => evaluation.status === 'fail')) {
    return 'fail';
  }
  if (evaluations.some(evaluation => evaluation.status === 'warning')) {
    return 'warning';
  }
  return 'pass';
}

export async function runDeterministicValidation({
  tenantId,
  entityType,
  entityId,
  payload,
  triggeredBy,
}: DeterministicRunInput): Promise<DeterministicRunResult> {
  const { runId } = await startValidationRun({ tenantId, entityType, entityId, triggeredBy });
  const auditTrail: ValidationAuditEvent[] = [];
  const rejections: ValidationRejection[] = [];
  const overrides: ValidationOverride[] = [];

  const summaryComponents = await Promise.all(
    executableRulePacks.map(async pack => {
      const evaluations = pack.evaluate(payload);
      const componentStatus = mapStatus(evaluations);

      await recordValidationComponent({
        runId,
        component: `${pack.domain}-rules`,
        status: componentStatus,
        errors: evaluations.filter(ev => ev.status === 'fail').map(ev => ev.message),
        warnings: evaluations.filter(ev => ev.status === 'warning').map(ev => ev.message),
        metrics: { ruleCount: evaluations.length },
      });

      for (const evaluation of evaluations) {
        const decision: Omit<ValidationDecision, 'id' | 'decidedAt'> = {
          runId,
          ruleId: evaluation.ruleId,
          ruleName: pack.rules.find(rule => rule.id === evaluation.ruleId)?.name ?? evaluation.ruleId,
          domain: pack.domain as ValidationDomain,
          status: evaluation.status,
          message: evaluation.message,
          dataPath: evaluation.dataPath,
          metadata: evaluation.metadata,
        };
        const recorded = await recordValidationDecision(decision);
        auditTrail.push(
          await recordAuditEvent({
            runId,
            action: 'decision_recorded',
            actor: triggeredBy,
            context: { decision: recorded },
          })
        );

        if (evaluation.status === 'fail') {
          const rejection = await recordRejection({
            runId,
            domain: pack.domain as ValidationDomain,
            reason: evaluation.message,
            severity: 'critical',
          });
          rejections.push(rejection);
        }
      }

      return {
        component: pack.domain,
        status: componentStatus,
        errors: evaluations.filter(ev => ev.status === 'fail').map(ev => ev.message),
        warnings: evaluations.filter(ev => ev.status === 'warning').map(ev => ev.message),
        metrics: { ruleCount: evaluations.length },
      };
    })
  );

  const finalStatus = summaryComponents.some(component => component.status === 'fail')
    ? 'fail'
    : summaryComponents.some(component => component.status === 'warning')
      ? 'warning'
      : 'pass';

  await completeValidationRun({
    runId,
    status: finalStatus,
    errors: summaryComponents.flatMap(component => component.errors),
    warnings: summaryComponents.flatMap(component => component.warnings),
    summary: { components: summaryComponents },
  });

  const run: ValidationRunSummary = {
    id: runId,
    tenantId,
    entityType,
    entityId,
    status: finalStatus,
    errors: summaryComponents.flatMap(component => component.errors),
    warnings: summaryComponents.flatMap(component => component.warnings),
    summary: { components: summaryComponents },
    triggeredBy,
    triggeredAt: new Date(),
    completedAt: new Date(),
    components: summaryComponents,
  };

  logger.info('Deterministic validation completed', { runId, status: run.status });

  return { run, rejections, overrides, auditTrail };
}

export async function overrideValidationDecision(
  decisionId: string,
  newStatus: ValidationStatus,
  userId: UserId,
  reason: string
): Promise<ValidationOverride> {
  const override = await recordValidationOverride({
    decisionId,
    overriddenBy: userId,
    reason,
    newStatus,
  });
  await recordAuditEvent({
    runId: override.runId ?? decisionId,
    action: 'decision_overridden',
    actor: userId,
    context: { decisionId, newStatus, reason },
  });
  return override;
}
