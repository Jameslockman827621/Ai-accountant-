import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('reconciliation-service');

export type ExceptionSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ReconciliationException {
  id: string;
  bankTransactionId: string;
  category: string;
  severity: ExceptionSeverity;
  reason: string | null;
  status: 'open' | 'in_review' | 'resolved';
  details: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function logReconciliationException(
  tenantId: TenantId,
  bankTransactionId: string,
  category: string,
  severity: ExceptionSeverity,
  reason: string,
  details?: Record<string, unknown>
): Promise<void> {
  await db.query(
    `INSERT INTO reconciliation_exceptions (
       tenant_id,
       bank_transaction_id,
       category,
       severity,
       reason,
       details,
       status
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'open')
     ON CONFLICT (tenant_id, bank_transaction_id, status)
     WHERE status <> 'resolved'
     DO UPDATE SET
       severity = EXCLUDED.severity,
       reason = EXCLUDED.reason,
       details = EXCLUDED.details,
       updated_at = NOW()`,
    [tenantId, bankTransactionId, category, severity, reason, JSON.stringify(details || {})]
  );
}

export async function resolveReconciliationException(
  tenantId: TenantId,
  exceptionId: string,
  userId?: string,
  resolution?: string
): Promise<void> {
  await db.query(
    `UPDATE reconciliation_exceptions
     SET status = 'resolved',
         resolution = $4,
         resolved_at = NOW(),
         resolved_by = $5,
         updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2`,
    [exceptionId, tenantId, 'resolved', resolution || null, userId || null]
  );
}

export async function resolveExceptionsForTransaction(
  tenantId: TenantId,
  bankTransactionId: string,
  userId?: string
): Promise<void> {
  await db.query(
    `UPDATE reconciliation_exceptions
     SET status = 'resolved',
         resolution = 'Transaction reconciled automatically',
         resolved_at = NOW(),
         resolved_by = $3,
         updated_at = NOW()
     WHERE tenant_id = $1
       AND bank_transaction_id = $2
       AND status <> 'resolved'`,
    [tenantId, bankTransactionId, userId || null]
  );
}

export async function listReconciliationExceptions(
  tenantId: TenantId,
  status: 'open' | 'in_review' | 'resolved' = 'open'
): Promise<ReconciliationException[]> {
  const result = await db.query<{
    id: string;
    bank_transaction_id: string;
    category: string;
    severity: ExceptionSeverity;
    reason: string | null;
    status: 'open' | 'in_review' | 'resolved';
    details: Record<string, unknown> | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, bank_transaction_id, category, severity, reason, status, details, created_at, updated_at
     FROM reconciliation_exceptions
     WHERE tenant_id = $1 AND status = $2
     ORDER BY created_at DESC`,
    [tenantId, status]
  );

  return result.rows.map((row) => ({
    id: row.id,
    bankTransactionId: row.bank_transaction_id,
    category: row.category,
    severity: row.severity,
    reason: row.reason,
    status: row.status,
    details: row.details,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
