import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import {
  TenantId,
  ValidationRunSummary,
  ValidationStatus,
  ValidationComponentSummary,
  UserId,
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
