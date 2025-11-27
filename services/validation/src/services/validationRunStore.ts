import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import {
  TenantId,
  ValidationRunSummary,
  ValidationStatus,
  ValidationComponentSummary,
  UserId,
  ValidationDecision,
  ValidationDomain,
  ValidationRejection,
  ValidationOverride,
  ValidationAuditEvent,
} from '@ai-accountant/shared-types';

const logger = createLogger('validation-service');

interface StartRunInput {
  tenantId: TenantId;
  entityType: string;
  entityId: string;
  triggeredBy?: UserId;
}

interface CompleteRunInput {
  runId: string;
  status: ValidationStatus;
  errors?: string[];
  warnings?: string[];
  summary?: Record<string, unknown>;
}

interface ComponentRecordInput {
  runId: string;
  component: string;
  status: ValidationStatus;
  errors?: string[];
  warnings?: string[];
  metrics?: Record<string, unknown>;
}

interface DecisionRecordInput {
  runId: string;
  ruleId: string;
  ruleName: string;
  domain: ValidationDomain;
  status: ValidationStatus;
  message: string;
  dataPath?: string;
  metadata?: Record<string, unknown>;
}

interface RejectionRecordInput {
  runId: string;
  domain: ValidationDomain;
  reason: string;
  severity: 'warning' | 'critical';
}

interface OverrideRecordInput {
  decisionId: string;
  overriddenBy: UserId;
  reason: string;
  newStatus: ValidationStatus;
}

interface AuditEventInput {
  runId: string;
  action: string;
  actor?: UserId;
  context?: Record<string, unknown>;
}

const INSERT_RUN = `
  INSERT INTO validation_runs (
    tenant_id,
    entity_type,
    entity_id,
    status,
    errors,
    warnings,
    summary,
    triggered_by
  ) VALUES ($1, $2, $3, 'warning', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, $4)
  RETURNING id, triggered_at
`;

const INSERT_COMPONENT = `
  INSERT INTO validation_run_components (
    run_id,
    component,
    status,
    errors,
    warnings,
    metrics
  ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb)
  RETURNING id
`;

const COMPLETE_RUN = `
  UPDATE validation_runs
  SET status = $2,
      errors = $3::jsonb,
      warnings = $4::jsonb,
      summary = $5::jsonb,
      completed_at = NOW()
  WHERE id = $1
`;

const INSERT_DECISION = `
  INSERT INTO validation_decisions (
    run_id,
    rule_id,
    rule_name,
    domain,
    status,
    message,
    data_path,
    metadata
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
  RETURNING *
`;

const INSERT_REJECTION = `
  INSERT INTO validation_rejection_queue (
    run_id,
    domain,
    reason,
    severity
  ) VALUES ($1, $2, $3, $4)
  RETURNING *
`;

const INSERT_OVERRIDE = `
  INSERT INTO validation_overrides (
    decision_id,
    overridden_by,
    reason,
    previous_status,
    new_status
  )
  SELECT id, $2, $3, status, $4
  FROM validation_decisions
  WHERE id = $1
  RETURNING *, (SELECT run_id FROM validation_decisions WHERE id = $1) AS run_id
`;

const INSERT_AUDIT_EVENT = `
  INSERT INTO validation_audit_events (
    run_id,
    actor,
    action,
    context
  ) VALUES ($1, $2, $3, $4::jsonb)
  RETURNING *
`;

const FETCH_LATEST_RUN = `
  SELECT
    r.id,
    r.tenant_id,
    r.entity_type,
    r.entity_id,
    r.status,
    r.errors,
    r.warnings,
    r.summary,
    r.triggered_by,
    r.triggered_at,
    r.completed_at,
    json_agg(
      jsonb_build_object(
        'component', c.component,
        'status', c.status,
        'errors', c.errors,
        'warnings', c.warnings,
        'metrics', c.metrics
      )
    ) AS components
  FROM validation_runs r
  LEFT JOIN validation_run_components c ON c.run_id = r.id
  WHERE r.tenant_id = $1 AND r.entity_type = $2 AND r.entity_id = $3
  GROUP BY r.id
  ORDER BY r.triggered_at DESC
  LIMIT 1
`;

export async function startValidationRun(input: StartRunInput): Promise<{ runId: string }> {
  const result = await db.query<{ id: string }>(INSERT_RUN, [
    input.tenantId,
    input.entityType,
    input.entityId,
    input.triggeredBy || null,
  ]);
  const runId = result.rows[0]?.id;
  if (!runId) {
    throw new Error('Failed to start validation run');
  }
  logger.info('Validation run started', { runId, ...input });
  return { runId };
}

export async function recordValidationComponent(input: ComponentRecordInput): Promise<void> {
  await db.query(INSERT_COMPONENT, [
    input.runId,
    input.component,
    input.status,
    JSON.stringify(input.errors ?? []),
    JSON.stringify(input.warnings ?? []),
    JSON.stringify(input.metrics ?? {}),
  ]);
}

export async function completeValidationRun(input: CompleteRunInput): Promise<void> {
  await db.query(COMPLETE_RUN, [
    input.runId,
    input.status,
    JSON.stringify(input.errors ?? []),
    JSON.stringify(input.warnings ?? []),
    JSON.stringify(input.summary ?? {}),
  ]);
  logger.info('Validation run completed', { runId: input.runId, status: input.status });
}

function mapComponent(row: Record<string, any>): ValidationComponentSummary {
  return {
    component: row.component,
    status: row.status,
    errors: Array.isArray(row.errors) ? row.errors : [],
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    metrics: (row.metrics as Record<string, unknown> | undefined) ?? {},
  };
}

export async function getLatestValidationRun(
  tenantId: TenantId,
  entityType: string,
  entityId: string
): Promise<ValidationRunSummary | null> {
  const result = await db.query<{
    id: string;
    tenant_id: TenantId;
    entity_type: string;
    entity_id: string;
    status: ValidationStatus;
    errors: string[];
    warnings: string[];
    summary: Record<string, unknown>;
    triggered_by: UserId | null;
    triggered_at: Date;
    completed_at: Date | null;
    components: Array<{
      component: string;
      status: ValidationStatus;
      errors: string[];
      warnings: string[];
      metrics: Record<string, unknown>;
    }> | null;
  }>(FETCH_LATEST_RUN, [tenantId, entityType, entityId]);

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    status: row.status,
    errors: Array.isArray(row.errors) ? row.errors : [],
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    summary: (row.summary as Record<string, unknown>) ?? {},
    triggeredBy: row.triggered_by ?? undefined,
    triggeredAt: row.triggered_at,
    completedAt: row.completed_at ?? undefined,
    components: Array.isArray(row.components)
      ? row.components.filter(Boolean).map(mapComponent)
      : [],
  };
}

export async function recordValidationDecision(
  input: DecisionRecordInput
): Promise<ValidationDecision> {
  const result = await db.query(INSERT_DECISION, [
    input.runId,
    input.ruleId,
    input.ruleName,
    input.domain,
    input.status,
    input.message,
    input.dataPath || null,
    JSON.stringify(input.metadata ?? {}),
  ]);
  const row = result.rows[0] as any;
  return {
    id: row.id,
    runId: row.run_id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    domain: row.domain,
    status: row.status,
    message: row.message,
    dataPath: row.data_path ?? undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    decidedAt: row.decided_at ?? new Date(),
  };
}

export async function recordRejection(input: RejectionRecordInput): Promise<ValidationRejection> {
  const result = await db.query(INSERT_REJECTION, [
    input.runId,
    input.domain,
    input.reason,
    input.severity,
  ]);
  const row = result.rows[0] as any;
  return {
    id: row.id,
    runId: row.run_id,
    domain: row.domain,
    reason: row.reason,
    severity: row.severity,
    queuedAt: row.queued_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

export async function recordValidationOverride(input: OverrideRecordInput): Promise<ValidationOverride> {
  const result = await db.query(INSERT_OVERRIDE, [
    input.decisionId,
    input.overriddenBy,
    input.reason,
    input.newStatus,
  ]);
  const row = result.rows[0] as any;
  return {
    id: row.id,
    decisionId: row.decision_id,
    overriddenBy: row.overridden_by,
    reason: row.reason,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    createdAt: row.created_at,
    runId: row.run_id ?? undefined,
  };
}

export async function recordAuditEvent(input: AuditEventInput): Promise<ValidationAuditEvent> {
  const result = await db.query(INSERT_AUDIT_EVENT, [
    input.runId,
    input.actor || null,
    input.action,
    JSON.stringify(input.context ?? {}),
  ]);
  const row = result.rows[0] as any;
  return {
    id: row.id,
    runId: row.run_id,
    actor: row.actor ?? undefined,
    action: row.action,
    context: (row.context as Record<string, unknown>) ?? {},
    createdAt: row.created_at,
  };
}
