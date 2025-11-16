import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('filing-service');

export interface FilingRejection {
  filingId: string;
  rejectionReason: string;
  rejectionCode?: string;
  rejectionDetails?: Record<string, unknown>;
  rejectedAt: Date;
  canResubmit: boolean;
  resubmissionGuidance?: string[];
}

/**
 * Handle HMRC filing rejections
 */
export async function handleFilingRejection(
  filingId: string,
  tenantId: TenantId,
  rejectionReason: string,
  rejectionCode?: string,
  rejectionDetails?: Record<string, unknown>
): Promise<FilingRejection> {
  logger.warn('Handling filing rejection', { filingId, rejectionReason, rejectionCode });

  // Update filing status
  await db.query(
    `UPDATE filings
     SET status = 'rejected',
         rejected_at = NOW(),
         rejection_reason = $1,
         updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [rejectionReason, filingId, tenantId]
  );

  // Store rejection details
  await db.query(
    `INSERT INTO filing_rejections (
      id, filing_id, tenant_id, rejection_reason, rejection_code,
      rejection_details, rejected_at, created_at
    ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, NOW(), NOW())
    ON CONFLICT (filing_id) DO UPDATE
    SET rejection_reason = EXCLUDED.rejection_reason,
        rejection_code = EXCLUDED.rejection_code,
        rejection_details = EXCLUDED.rejection_details,
        rejected_at = NOW(),
        updated_at = NOW()`,
    [
      filingId,
      tenantId,
      rejectionReason,
      rejectionCode || null,
      JSON.stringify(rejectionDetails || {}),
    ]
  );

  // Determine if can resubmit and provide guidance
  const canResubmit = !rejectionCode || !['FINAL', 'PERMANENT'].includes(rejectionCode);
  const resubmissionGuidance = generateResubmissionGuidance(rejectionReason, rejectionCode, rejectionDetails);

  logger.info('Filing rejection handled', { filingId, canResubmit });

  return {
    filingId,
    rejectionReason,
    rejectionCode,
    rejectionDetails,
    rejectedAt: new Date(),
    canResubmit,
    resubmissionGuidance,
  };
}

/**
 * Get rejection details for a filing
 */
export async function getFilingRejection(
  filingId: string,
  tenantId: TenantId
): Promise<FilingRejection | null> {
  const result = await db.query<{
    filing_id: string;
    rejection_reason: string;
    rejection_code: string | null;
    rejection_details: string | null;
    rejected_at: Date;
  }>(
    `SELECT 
       filing_id, rejection_reason, rejection_code,
       rejection_details, rejected_at
     FROM filing_rejections
     WHERE filing_id = $1 AND tenant_id = $2`,
    [filingId, tenantId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  const rejectionDetails = row.rejection_details ? JSON.parse(row.rejection_details) : undefined;

  const canResubmit = !row.rejection_code || !['FINAL', 'PERMANENT'].includes(row.rejection_code);
  const resubmissionGuidance = generateResubmissionGuidance(
    row.rejection_reason,
    row.rejection_code || undefined,
    rejectionDetails
  );

  return {
    filingId: row.filing_id,
    rejectionReason: row.rejection_reason,
    rejectionCode: row.rejection_code || undefined,
    rejectionDetails,
    rejectedAt: row.rejected_at,
    canResubmit,
    resubmissionGuidance,
  };
}

function generateResubmissionGuidance(
  rejectionReason: string,
  rejectionCode?: string,
  rejectionDetails?: Record<string, unknown>
): string[] {
  const guidance: string[] = [];

  const reasonLower = rejectionReason.toLowerCase();

  // Common rejection reasons and guidance
  if (reasonLower.includes('invalid') || reasonLower.includes('format')) {
    guidance.push('Review the filing format and ensure all fields are correctly formatted');
    guidance.push('Check that dates are in the correct format (YYYY-MM-DD)');
    guidance.push('Verify that numeric values are within acceptable ranges');
  }

  if (reasonLower.includes('missing') || reasonLower.includes('required')) {
    guidance.push('Ensure all required fields are completed');
    guidance.push('Check that mandatory attachments are included');
  }

  if (reasonLower.includes('calculation') || reasonLower.includes('amount')) {
    guidance.push('Review all calculations for accuracy');
    guidance.push('Verify that totals match the sum of line items');
    guidance.push('Check that tax calculations are correct');
  }

  if (reasonLower.includes('date') || reasonLower.includes('period')) {
    guidance.push('Verify that the filing period is correct');
    guidance.push('Ensure the period dates are within the allowed range');
  }

  if (reasonLower.includes('authentication') || reasonLower.includes('authorization')) {
    guidance.push('Re-authenticate with HMRC if required');
    guidance.push('Check that your HMRC connection is still valid');
  }

  // Generic guidance
  if (guidance.length === 0) {
    guidance.push('Review the rejection reason carefully');
    guidance.push('Make necessary corrections to the filing');
    guidance.push('Consider contacting HMRC support if the issue is unclear');
  }

  // Add code-specific guidance
  if (rejectionCode) {
    guidance.push(`Rejection code: ${rejectionCode} - refer to HMRC documentation for specific guidance`);
  }

  return guidance;
}
