import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

export interface FilingSubmissionRecord {
  id: string;
  submissionType: string;
  status: string;
  submissionId: string | null;
  periodKey: string | null;
  receiptId: string | null;
  submittedAt: Date | null;
  submittedBy: string | null;
  error: string | null;
  payload: Record<string, unknown> | null;
  hmrcResponse: Record<string, unknown> | null;
  parentSubmissionId: string | null;
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  try {
    return JSON.parse(String(value)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function listFilingSubmissions(
  tenantId: TenantId,
  filingId: string
): Promise<FilingSubmissionRecord[]> {
  const result = await db.query<{
    id: string;
    submission_type: string;
    status: string;
    submission_id: string | null;
    period_key: string | null;
    receipt_id: string | null;
    submitted_at: Date | null;
    submitted_by: string | null;
    error: string | null;
    payload: unknown;
    hmrc_response: unknown;
    parent_submission_id: string | null;
  }>(
    `SELECT
        id,
        submission_type,
        status,
        submission_id,
        period_key,
        receipt_id,
        submitted_at,
        submitted_by,
        error,
        payload,
        hmrc_response,
        parent_submission_id
     FROM filing_submissions
     WHERE tenant_id = $1 AND filing_id = $2
     ORDER BY created_at DESC`,
    [tenantId, filingId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    submissionType: row.submission_type,
    status: row.status,
    submissionId: row.submission_id,
    periodKey: row.period_key,
    receiptId: row.receipt_id,
    submittedAt: row.submitted_at,
    submittedBy: row.submitted_by,
    error: row.error,
    payload: parseJson(row.payload),
    hmrcResponse: parseJson(row.hmrc_response),
    parentSubmissionId: row.parent_submission_id,
  }));
}

export async function createAmendmentDraft(options: {
  filingId: string;
  tenantId: TenantId;
  userId: string;
  adjustments: Record<string, unknown>;
  reason?: string;
  parentSubmissionId?: string | null;
}): Promise<string> {
  const payload = {
    adjustments: options.adjustments,
    reason: options.reason || null,
  };

  const result = await db.query<{ id: string }>(
    `INSERT INTO filing_submissions (
        filing_id,
        tenant_id,
        submission_type,
        status,
        payload,
        submitted_by,
        parent_submission_id
      )
      VALUES ($1, $2, 'amendment', 'draft', $3::jsonb, $4, $5)
      RETURNING id`,
    [
      options.filingId,
      options.tenantId,
      JSON.stringify(payload),
      options.userId,
      options.parentSubmissionId || null,
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to create amendment draft');
  }

  return row.id;
}

export async function getDraftAmendmentSubmission(
  tenantId: TenantId,
  filingId: string
): Promise<{
  id: string;
  payload: Record<string, unknown> | null;
  parentSubmissionId: string | null;
} | null> {
  const result = await db.query<{
    id: string;
    payload: unknown;
    parent_submission_id: string | null;
  }>(
    `SELECT id, payload, parent_submission_id
     FROM filing_submissions
     WHERE tenant_id = $1
       AND filing_id = $2
       AND submission_type = 'amendment'
       AND status = 'draft'
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId, filingId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    payload: parseJson(row.payload),
    parentSubmissionId: row.parent_submission_id,
  };
}
