import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { normalizeRetryPolicy, StandardizedErrorPolicy } from './errorStandards';

const logger = createLogger('resilience-service');

export interface DeadLetterPayload {
  source: string;
  tenantId?: string;
  operationId?: string;
  operationType?: string;
  error: string;
  metadata?: Record<string, unknown>;
  policy?: StandardizedErrorPolicy;
}

export async function enqueueDeadLetter(payload: DeadLetterPayload): Promise<void> {
  const policy = payload.policy
    ? { ...payload.policy, retryPolicy: normalizeRetryPolicy(payload.policy.retryPolicy) }
    : undefined;
  await db.query(
    `INSERT INTO dead_letter_queue (
      id, source, tenant_id, operation_id, operation_type, error, metadata, policy, created_at
    ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NOW())`,
    [
      payload.source,
      payload.tenantId || null,
      payload.operationId || null,
      payload.operationType || null,
      payload.error,
      JSON.stringify(payload.metadata || {}),
      JSON.stringify(policy || null),
    ]
  );

  logger.warn('Routed to dead letter queue', {
    source: payload.source,
    operationId: payload.operationId,
    operationType: payload.operationType,
  });
}
