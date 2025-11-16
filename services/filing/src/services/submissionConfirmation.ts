import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('filing-service');

export interface SubmissionConfirmation {
  filingId: string;
  submissionId: string;
  submittedAt: Date;
  confirmationNumber?: string;
  receipt?: {
    url: string;
    storageKey: string;
    contentType: string;
  };
  status: 'submitted' | 'accepted' | 'rejected';
  responseData?: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Store submission confirmation and receipts from HMRC
 */
export async function storeSubmissionConfirmation(
  filingId: string,
  tenantId: TenantId,
  submissionId: string,
  confirmationNumber?: string,
  receiptData?: {
    url: string;
    storageKey: string;
    contentType: string;
  },
  responseData?: Record<string, unknown>
): Promise<void> {
  logger.info('Storing submission confirmation', { filingId, submissionId });

  // Check if confirmation already exists
  const existingResult = await db.query<{
    id: string;
  }>(
    `SELECT id
     FROM filing_submission_confirmations
     WHERE filing_id = $1`,
    [filingId]
  );

  if (existingResult.rows.length > 0) {
    // Update existing
    await db.query(
      `UPDATE filing_submission_confirmations
       SET submission_id = $1,
           confirmation_number = $2,
           receipt_url = $3,
           receipt_storage_key = $4,
           receipt_content_type = $5,
           response_data = $6::jsonb,
           updated_at = NOW()
       WHERE filing_id = $7`,
      [
        submissionId,
        confirmationNumber || null,
        receiptData?.url || null,
        receiptData?.storageKey || null,
        receiptData?.contentType || null,
        JSON.stringify(responseData || {}),
        filingId,
      ]
    );
  } else {
    // Create new
    await db.query(
      `INSERT INTO filing_submission_confirmations (
        id, filing_id, tenant_id, submission_id, confirmation_number,
        receipt_url, receipt_storage_key, receipt_content_type,
        response_data, created_at, updated_at
      ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), NOW())`,
      [
        filingId,
        tenantId,
        submissionId,
        confirmationNumber || null,
        receiptData?.url || null,
        receiptData?.storageKey || null,
        receiptData?.contentType || null,
        JSON.stringify(responseData || {}),
      ]
    );
  }

  // Update filing status
  await db.query(
    `UPDATE filings
     SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [filingId]
  );

  logger.info('Submission confirmation stored', { filingId, submissionId });
}

/**
 * Get submission confirmation for a filing
 */
export async function getSubmissionConfirmation(
  filingId: string,
  tenantId: TenantId
): Promise<SubmissionConfirmation | null> {
  const result = await db.query<{
    filing_id: string;
    submission_id: string;
    confirmation_number: string | null;
    receipt_url: string | null;
    receipt_storage_key: string | null;
    receipt_content_type: string | null;
    response_data: string | null;
    created_at: Date;
  }>(
    `SELECT 
       filing_id, submission_id, confirmation_number,
       receipt_url, receipt_storage_key, receipt_content_type,
       response_data, created_at
     FROM filing_submission_confirmations
     WHERE filing_id = $1 AND tenant_id = $2`,
    [filingId, tenantId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Get filing status
  const filingResult = await db.query<{
    status: string;
    submitted_at: Date | null;
  }>(
    `SELECT status, submitted_at
     FROM filings
     WHERE id = $1`,
    [filingId]
  );

  const filing = filingResult.rows[0];

  return {
    filingId: row.filing_id,
    submissionId: row.submission_id,
    submittedAt: filing.submitted_at || row.created_at,
    confirmationNumber: row.confirmation_number || undefined,
    receipt: row.receipt_url
      ? {
          url: row.receipt_url,
          storageKey: row.receipt_storage_key || '',
          contentType: row.receipt_content_type || 'application/pdf',
        }
      : undefined,
    status: filing.status as 'submitted' | 'accepted' | 'rejected',
    responseData: row.response_data ? JSON.parse(row.response_data) : undefined,
    createdAt: row.created_at,
  };
}
