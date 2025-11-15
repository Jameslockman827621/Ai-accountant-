import { randomUUID } from 'crypto';
import { db } from '@ai-accountant/database';
import { TenantId, FilingStatus } from '@ai-accountant/shared-types';
import { createLogger } from '@ai-accountant/shared-utils';
import {
  HMRCClient,
  HMRCSubmissionResponse,
  VATReturnPayload,
} from '@ai-accountant/hmrc';
import { getTenantHMRCAuth } from '@ai-accountant/integrations-service/services/hmrc';
import { storeReceiptArtifact } from '../storage/receiptStorage';

const logger = createLogger('filing-service');

const HMRC_ENV = process.env.HMRC_ENV === 'production' ? 'production' : 'sandbox';
const HMRC_BASE_URL = process.env.HMRC_BASE_URL;

export type SubmissionType = 'initial' | 'resubmission' | 'amendment';

interface SubmissionOptions {
  filingId: string;
  tenantId: TenantId;
  userId: string;
  payload: VATReturnPayload;
  submissionType: SubmissionType;
  reuseSubmissionRecordId?: string;
  parentSubmissionId?: string | null;
}

export async function submitTenantVatReturn(
  options: SubmissionOptions
): Promise<{
  submissionRecordId: string;
  hmrcSubmissionId: string;
  receiptId: string;
  processingDate: string;
}> {
  try {
    const auth = await getTenantHMRCAuth(options.tenantId);
    const client = new HMRCClient({
      env: HMRC_ENV,
      ...(HMRC_BASE_URL ? { baseUrl: HMRC_BASE_URL } : {}),
      accessToken: auth.accessToken,
    });

    const response = await client.submitVatReturn(auth.vrn, options.payload);
    const receiptId =
      response.receiptId ||
      response.formBundleNumber ||
      randomUUID();

    const submissionOutcome = await persistSubmissionSuccess({
      ...options,
      vrn: auth.vrn,
      hmrcResponse: response,
      receiptId,
    });

    logger.info('VAT filing submitted via HMRC', {
      filingId: options.filingId,
      tenantId: options.tenantId,
      submissionType: options.submissionType,
      submissionRecordId: submissionOutcome.submissionRecordId,
    });

    return {
      submissionRecordId: submissionOutcome.submissionRecordId,
      hmrcSubmissionId: submissionOutcome.hmrcSubmissionId,
      receiptId,
      processingDate:
        response.processingDate || new Date().toISOString(),
    };
  } catch (error) {
    await persistSubmissionFailure(options, error);
    throw error;
  }
}

async function persistSubmissionSuccess(args: SubmissionOptions & {
  vrn: string;
  hmrcResponse: HMRCSubmissionResponse;
  receiptId: string;
}): Promise<{ submissionRecordId: string; hmrcSubmissionId: string }> {
  const payloadJson = JSON.stringify(args.payload);
  const responseJson = JSON.stringify(args.hmrcResponse);
  const periodKey = args.payload.periodKey;
  const hmrcSubmissionId =
    args.hmrcResponse.formBundleNumber ||
    args.hmrcResponse.receiptId ||
    args.receiptId;
  let storageKey: string | null = null;

  try {
    storageKey = await storeReceiptArtifact({
      tenantId: args.tenantId,
      filingId: args.filingId,
      submissionId: hmrcSubmissionId,
      payload: args.hmrcResponse,
    });
  } catch (error) {
    logger.warn(
      'Failed to archive receipt artifact',
      error instanceof Error ? error : new Error(String(error)),
      { filingId: args.filingId, submissionId: hmrcSubmissionId }
    );
  }

  let submissionRecordId = args.reuseSubmissionRecordId;

  if (submissionRecordId) {
    await db.query(
      `UPDATE filing_submissions
       SET status = 'submitted',
           submission_id = $2,
           vrn = $3,
           period_key = $4,
           receipt_id = $5,
           payload = $6::jsonb,
           hmrc_response = $7::jsonb,
           submitted_at = NOW(),
           submitted_by = $8
       WHERE id = $1`,
      [
        submissionRecordId,
        hmrcSubmissionId,
        args.vrn,
        periodKey,
        args.receiptId,
        payloadJson,
        responseJson,
        args.userId,
      ]
    );
  } else {
    const insertion = await db.query<{ id: string }>(
      `INSERT INTO filing_submissions (
          filing_id,
          tenant_id,
          submission_type,
          status,
          submission_id,
          vrn,
          period_key,
          receipt_id,
          payload,
          hmrc_response,
          submitted_at,
          submitted_by,
          parent_submission_id
        )
        VALUES (
          $1, $2, $3, 'submitted', $4, $5, $6, $7, $8::jsonb, $9::jsonb, NOW(), $10, $11
        )
        RETURNING id`,
      [
        args.filingId,
        args.tenantId,
        args.submissionType,
        hmrcSubmissionId,
        args.vrn,
        periodKey,
        args.receiptId,
        payloadJson,
        responseJson,
        args.userId,
        args.parentSubmissionId || null,
      ]
    );
    submissionRecordId = insertion.rows[0].id;
  }

  await db.query(
    `UPDATE filings
     SET status = $1,
         submitted_at = NOW(),
         last_submission_id = $2,
         rejection_reason = NULL,
         updated_at = NOW()
     WHERE id = $3`,
    [FilingStatus.SUBMITTED, submissionRecordId, args.filingId]
  );

    await db.query(
      `INSERT INTO filing_receipts (
         filing_id,
         tenant_id,
         submission_id,
         payload,
         storage_key,
         submission_record_id
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (filing_id, submission_id) DO UPDATE
       SET payload = EXCLUDED.payload,
           storage_key = COALESCE(EXCLUDED.storage_key, filing_receipts.storage_key),
           submission_record_id = EXCLUDED.submission_record_id,
           updated_at = NOW()`,
      [
        args.filingId,
        args.tenantId,
        hmrcSubmissionId,
        responseJson,
        storageKey,
        submissionRecordId,
      ]
    );

  return { submissionRecordId, hmrcSubmissionId };
}

async function persistSubmissionFailure(
  options: SubmissionOptions,
  error: unknown
): Promise<void> {
  const message =
    error instanceof Error ? error.message : String(error);

  if (options.reuseSubmissionRecordId) {
    await db.query(
      `UPDATE filing_submissions
       SET status = 'failed',
           error = $2,
           submitted_at = NOW(),
           submitted_by = $3
       WHERE id = $1`,
      [options.reuseSubmissionRecordId, message, options.userId]
    );
  } else {
    await db.query(
      `INSERT INTO filing_submissions (
         filing_id,
         tenant_id,
         submission_type,
         status,
         error,
         payload,
         submitted_at,
         submitted_by,
         parent_submission_id
       ) VALUES ($1, $2, $3, 'failed', $4, $5::jsonb, NOW(), $6, $7)`,
      [
        options.filingId,
        options.tenantId,
        options.submissionType,
        message,
        JSON.stringify(options.payload),
        options.userId,
        options.parentSubmissionId || null,
      ]
    );
  }

  await db.query(
    `UPDATE filings
     SET status = $1,
         rejection_reason = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [FilingStatus.ERROR, message, options.filingId]
  );

  const errObject = error instanceof Error ? error : new Error(message);
  logger.error('HMRC submission failed', errObject, {
    filingId: options.filingId,
    tenantId: options.tenantId,
    submissionType: options.submissionType,
  });
}
