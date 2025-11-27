import { randomUUID } from 'crypto';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { getTenantHMRCAuth } from '@ai-accountant/integrations-service/services/hmrc';
import { sendDeadlineReminders } from './deadlineManager';
import { submitTenantVatReturn, SubmissionType } from './hmrcSubmission';
import { VATReturnPayload } from '@ai-accountant/hmrc';

const logger = createLogger('filing-hmrc-flow');

export interface HMRCAuthorizationContext {
  vrn: string;
  accessToken: string;
  expiresAt?: Date;
}

export interface HMRCSubmissionContext {
  filingId: string;
  tenantId: TenantId;
  userId: UserId;
  payload: VATReturnPayload;
  submissionType: SubmissionType;
  reuseSubmissionRecordId?: string;
  parentSubmissionId?: string | null;
}

/**
 * Ensure we have a valid HMRC authorization for the tenant.
 */
export async function ensureHmrcAuthorization(
  tenantId: TenantId
): Promise<HMRCAuthorizationContext> {
  const auth = await getTenantHMRCAuth(tenantId);
  if (!auth) {
    throw new Error('HMRC authorization missing for tenant');
  }

  return {
    vrn: auth.vrn,
    accessToken: auth.accessToken,
    expiresAt: auth.expiresAt ? new Date(auth.expiresAt) : undefined,
  };
}

/**
 * Run the full HMRC submission flow including audit logging and reminder updates.
 */
export async function runHmrcSubmissionFlow(
  context: HMRCSubmissionContext
): Promise<{ submissionId: string; receiptId: string; processingDate: string }> {
  const authContext = await ensureHmrcAuthorization(context.tenantId);
  const submissionResult = await submitTenantVatReturn(context);

  await recordFilingAuditEvent({
    filingId: context.filingId,
    tenantId: context.tenantId,
    userId: context.userId,
    action: 'submitted',
    details: {
      submissionType: context.submissionType,
      vrn: authContext.vrn,
      hmrcSubmissionId: submissionResult.hmrcSubmissionId,
    },
  });

  await sendDeadlineReminders(context.tenantId).catch((error) =>
    logger.warn('Deadline reminders failed after submission', error as Error)
  );

  return {
    submissionId: submissionResult.hmrcSubmissionId,
    receiptId: submissionResult.receiptId,
    processingDate: submissionResult.processingDate,
  };
}

/**
 * Persist callbacks from HMRC to maintain a full audit chain.
 */
export async function recordHmrcCallback(
  filingId: string,
  tenantId: TenantId,
  payload: unknown
): Promise<string> {
  const callbackId = randomUUID();

  await db.query(
    `INSERT INTO filing_audit_trail (
       id, filing_id, action, previous_status, new_status, user_id,
       comment, changes, created_at
     ) VALUES ($1, $2, 'hmrc_callback', NULL, NULL, NULL, $3, $4::jsonb, NOW())`,
    [callbackId, filingId, 'HMRC callback received', JSON.stringify(payload)]
  );

  logger.info('HMRC callback recorded', { filingId, callbackId });
  return callbackId;
}

interface FilingAuditEvent {
  filingId: string;
  tenantId: TenantId;
  userId: UserId | null;
  action: string;
  details?: Record<string, unknown>;
}

async function recordFilingAuditEvent(event: FilingAuditEvent): Promise<void> {
  await db.query(
    `INSERT INTO filing_audit_trail (
       id, filing_id, action, previous_status, new_status,
       user_id, user_name, user_email, comment, changes, created_at
     ) VALUES (
       gen_random_uuid(), $1, $2, NULL, NULL, $3, NULL, NULL, $4, $5::jsonb, NOW()
     )`,
    [
      event.filingId,
      event.action,
      event.userId,
      event.details?.comment || null,
      JSON.stringify(event.details || {}),
    ]
  );
}
