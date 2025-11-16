import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('filing-service');

export interface FilingAmendment {
  id: string;
  originalFilingId: string;
  tenantId: TenantId;
  filingType: string;
  periodStart: Date;
  periodEnd: Date;
  reason: string;
  changes: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
  }>;
  status: 'draft' | 'pending_approval' | 'submitted' | 'accepted' | 'rejected';
  createdBy: UserId;
  createdAt: Date;
}

/**
 * Handle filing amendments for correcting filed returns
 */
export async function createAmendmentDraft(
  originalFilingId: string,
  tenantId: TenantId,
  userId: UserId,
  reason: string,
  changes: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
  }>
): Promise<string> {
  logger.info('Creating amendment draft', { originalFilingId, tenantId });

  // Get original filing
  const originalResult = await db.query<{
    id: string;
    filing_type: string;
    period_start: Date;
    period_end: Date;
    filing_data: Record<string, unknown>;
    status: string;
  }>(
    `SELECT id, filing_type, period_start, period_end, filing_data, status
     FROM filings
     WHERE id = $1 AND tenant_id = $2`,
    [originalFilingId, tenantId]
  );

  if (originalResult.rows.length === 0) {
    throw new Error('Original filing not found');
  }

  const original = originalResult.rows[0];
  if (original.status !== 'submitted' && original.status !== 'accepted') {
    throw new Error('Can only amend submitted or accepted filings');
  }

  // Create amendment filing
  const amendmentId = randomUUID();
  const amendedData = { ...original.filing_data };

  // Apply changes
  for (const change of changes) {
    amendedData[change.field] = change.newValue;
  }

  await db.query(
    `INSERT INTO filings (
      id, tenant_id, filing_type, status, period_start, period_end,
      filing_data, calculated_by, model_version, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
    [
      amendmentId,
      tenantId,
      `${original.filing_type}_amendment`,
      'draft',
      original.period_start,
      original.period_end,
      JSON.stringify(amendedData),
      userId,
      '1.0.0',
    ]
  );

  // Create amendment record
  await db.query(
    `INSERT INTO filing_amendments (
      id, original_filing_id, tenant_id, amendment_filing_id, reason,
      changes, status, created_by, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      randomUUID(),
      originalFilingId,
      tenantId,
      amendmentId,
      reason,
      JSON.stringify(changes),
      'draft',
      userId,
    ]
  );

  logger.info('Amendment draft created', { amendmentId, originalFilingId });

  return amendmentId;
}

/**
 * Get amendment history for a filing
 */
export async function getFilingAmendments(
  originalFilingId: string,
  tenantId: TenantId
): Promise<FilingAmendment[]> {
  const result = await db.query<{
    id: string;
    original_filing_id: string;
    tenant_id: string;
    amendment_filing_id: string;
    reason: string;
    changes: string;
    status: string;
    created_by: string;
    created_at: Date;
  }>(
    `SELECT 
       fa.id,
       fa.original_filing_id,
       fa.tenant_id,
       fa.amendment_filing_id,
       fa.reason,
       fa.changes,
       fa.status,
       fa.created_by,
       fa.created_at,
       f.period_start,
       f.period_end,
       f.filing_type
     FROM filing_amendments fa
     JOIN filings f ON fa.amendment_filing_id = f.id
     WHERE fa.original_filing_id = $1 AND fa.tenant_id = $2
     ORDER BY fa.created_at DESC`,
    [originalFilingId, tenantId]
  );

  return result.rows.map(row => ({
    id: row.id,
    originalFilingId: row.original_filing_id,
    tenantId: row.tenant_id as TenantId,
    filingType: row.filing_type,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    reason: row.reason,
    changes: JSON.parse(row.changes) as FilingAmendment['changes'],
    status: row.status as FilingAmendment['status'],
    createdBy: row.created_by as UserId,
    createdAt: row.created_at,
  }));
}

/**
 * Submit an amendment filing
 */
export async function submitAmendment(
  amendmentFilingId: string,
  tenantId: TenantId,
  userId: UserId
): Promise<void> {
  // Get amendment record
  const amendmentResult = await db.query<{
    id: string;
    original_filing_id: string;
    status: string;
  }>(
    `SELECT id, original_filing_id, status
     FROM filing_amendments
     WHERE amendment_filing_id = $1 AND tenant_id = $2`,
    [amendmentFilingId, tenantId]
  );

  if (amendmentResult.rows.length === 0) {
    throw new Error('Amendment not found');
  }

  const amendment = amendmentResult.rows[0];
  if (amendment.status !== 'draft' && amendment.status !== 'pending_approval') {
    throw new Error(`Amendment is in ${amendment.status} status and cannot be submitted`);
  }

  // Update amendment status
  await db.query(
    `UPDATE filing_amendments
     SET status = 'submitted', updated_at = NOW()
     WHERE id = $1`,
    [amendment.id]
  );

  // Update filing status
  await db.query(
    `UPDATE filings
     SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [amendmentFilingId]
  );

  logger.info('Amendment submitted', { amendmentFilingId, originalFilingId: amendment.original_filing_id });
}
