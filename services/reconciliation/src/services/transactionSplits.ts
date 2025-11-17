import { db } from '@ai-accountant/database';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { resolveExceptionsForTransaction } from './exceptions';

const logger = createLogger('reconciliation-service');

const ALLOWED_SPLIT_STATUSES = ['draft', 'pending_review', 'applied', 'void'] as const;
type AllowedSplitStatus = (typeof ALLOWED_SPLIT_STATUSES)[number];

export interface TransactionSplitInput {
  amount: number | string;
  currency?: string;
  documentId?: string | null;
  ledgerEntryId?: string | null;
  memo?: string | null;
  tags?: string[];
  confidenceScore?: number | string | null;
}

export interface TransactionSplitResponse {
  id: string;
  status: AllowedSplitStatus;
  amount: number;
  currency: string;
  documentId: string | null;
  ledgerEntryId: string | null;
  memo: string | null;
  tags: string[];
  confidenceScore: number | null;
  createdAt: string;
  updatedAt: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  reviewNotes?: string | null;
}

export interface TransactionSplitSummary {
  transactionId: string;
  amount: number;
  currency: string;
  status: string;
  isSplit: boolean;
  splitRemainingAmount: number | null;
  splits: TransactionSplitResponse[];
  submittedBy?: string | null;
  submittedAt?: string | null;
  reviewNotes?: string | null;
}

const AMOUNT_TOLERANCE = 0.01;

function toNumber(value: number | string | null | undefined, fieldName: string): number {
  if (value === null || value === undefined) {
    throw new ValidationError(`${fieldName} is required`);
  }
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw new ValidationError(`${fieldName} must be a valid number`);
  }
  return parsed;
}

function sanitizeTags(tags?: unknown): string[] {
  if (!tags) {
    return [];
  }
  if (!Array.isArray(tags)) {
    throw new ValidationError('tags must be an array of strings');
  }
  const cleaned = tags.map((tag) => {
    if (typeof tag !== 'string') {
      throw new ValidationError('tags must be an array of strings');
    }
    return tag.trim();
  });
  return cleaned.filter((tag) => tag.length > 0);
}

export async function getTransactionSplits(
  tenantId: TenantId,
  bankTransactionId: string
): Promise<TransactionSplitSummary> {
  const transactionResult = await db.query<{
    id: string;
    amount: string;
    currency: string;
    is_split: boolean;
    split_status: string;
    split_remaining_amount: string | null;
    split_submitted_by: string | null;
    split_submitted_at: Date | null;
    split_review_notes: string | null;
  }>(
    `SELECT id,
            amount::text,
            currency,
            is_split,
            split_status,
            split_remaining_amount::text,
            split_submitted_by,
            split_submitted_at,
            split_review_notes
     FROM bank_transactions
     WHERE id = $1 AND tenant_id = $2`,
    [bankTransactionId, tenantId]
  );

  const transaction = transactionResult.rows[0];

  if (!transaction) {
    throw new ValidationError('Bank transaction not found');
  }

  const splitsResult = await db.query<{
    id: string;
    status: AllowedSplitStatus;
    split_amount: string;
    currency: string;
    document_id: string | null;
    ledger_entry_id: string | null;
    memo: string | null;
    tags: string[];
    confidence_score: string | null;
    approved_by: string | null;
    approved_at: Date | null;
    review_notes: string | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id,
            status::text AS status,
            split_amount::text,
            currency,
            document_id,
            ledger_entry_id,
            memo,
            tags,
            confidence_score::text,
            approved_by,
            approved_at,
            review_notes,
            created_at,
            updated_at
     FROM transaction_splits
     WHERE tenant_id = $1 AND bank_transaction_id = $2
     ORDER BY created_at ASC`,
    [tenantId, bankTransactionId]
  );

  const splits = splitsResult.rows.map((row) => ({
    id: row.id,
    status: row.status,
    amount: parseFloat(row.split_amount),
    currency: row.currency,
    documentId: row.document_id,
    ledgerEntryId: row.ledger_entry_id,
    memo: row.memo,
    tags: Array.isArray(row.tags) ? row.tags : [],
    confidenceScore: row.confidence_score ? parseFloat(row.confidence_score) : null,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at ? row.approved_at.toISOString() : null,
    reviewNotes: row.review_notes || null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }));

  const splitRemainingAmount = transaction.split_remaining_amount
    ? parseFloat(transaction.split_remaining_amount)
    : transaction.is_split
      ? 0
      : parseFloat(transaction.amount);

  return {
    transactionId: transaction.id,
    amount: parseFloat(transaction.amount),
    currency: transaction.currency,
    status: transaction.split_status,
    isSplit: transaction.is_split,
    splitRemainingAmount,
    splits,
    submittedBy: transaction.split_submitted_by,
    submittedAt: transaction.split_submitted_at ? transaction.split_submitted_at.toISOString() : null,
    reviewNotes: transaction.split_review_notes,
  };
}

export async function replaceTransactionSplits(
  tenantId: TenantId,
  bankTransactionId: string,
  userId: UserId,
  splitsInput: TransactionSplitInput[]
): Promise<TransactionSplitSummary> {
  if (!splitsInput || splitsInput.length === 0) {
    throw new ValidationError('At least one split is required');
  }

  await db.transaction(async (client) => {
    const transactionResult = await client.query<{
      id: string;
      amount: string;
      currency: string;
      reconciled: boolean;
    }>(
      `SELECT id, amount::text, currency, reconciled
       FROM bank_transactions
       WHERE id = $1 AND tenant_id = $2
       FOR UPDATE`,
      [bankTransactionId, tenantId]
    );

    const transaction = transactionResult.rows[0];
    if (!transaction) {
      throw new ValidationError('Bank transaction not found');
    }
    if (transaction.reconciled) {
      throw new ValidationError('Cannot split a reconciled transaction');
    }

    const transactionAmount = parseFloat(transaction.amount);
    const transactionCurrency = transaction.currency;

    const sanitizedSplits = splitsInput.map((split, index) => {
      const amountValue = toNumber(split.amount, `splits[${index}].amount`);
      if (amountValue <= 0) {
        throw new ValidationError('Split amount must be greater than 0');
      }
      const currency = (split.currency || transactionCurrency).toUpperCase();
      if (currency !== transactionCurrency) {
        throw new ValidationError(`Split currency must match transaction currency (${transactionCurrency})`);
      }
      const documentId = split.documentId ?? null;
      const ledgerEntryId = split.ledgerEntryId ?? null;
      if (!documentId && !ledgerEntryId) {
        throw new ValidationError('Each split must reference a document or a ledger entry');
      }
      const memo = split.memo ? String(split.memo).trim() : null;
      const tags = sanitizeTags(split.tags);
      const confidenceScore = split.confidenceScore === null || split.confidenceScore === undefined
        ? null
        : toNumber(split.confidenceScore, `splits[${index}].confidenceScore`);
      return {
        amount: amountValue,
        currency,
        documentId,
        ledgerEntryId,
        memo,
        tags,
        confidenceScore: confidenceScore !== null ? confidenceScore : null,
      };
    });

    const totalSplitAmount = sanitizedSplits.reduce((sum, split) => sum + split.amount, 0);
    if (Math.abs(totalSplitAmount - transactionAmount) > AMOUNT_TOLERANCE) {
      throw new ValidationError('Sum of split amounts must equal the bank transaction amount');
    }

    const documentIds = sanitizedSplits
      .map((split) => split.documentId)
      .filter((value): value is string => Boolean(value));
    if (documentIds.length > 0) {
      const docsResult = await client.query<{ id: string }>(
        `SELECT id FROM documents WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, documentIds]
      );
      if (docsResult.rows.length !== documentIds.length) {
        throw new ValidationError('One or more documents were not found for this tenant');
      }
    }

    const ledgerEntryIds = sanitizedSplits
      .map((split) => split.ledgerEntryId)
      .filter((value): value is string => Boolean(value));
    if (ledgerEntryIds.length > 0) {
      const ledgerResult = await client.query<{ id: string }>(
        `SELECT id FROM ledger_entries WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, ledgerEntryIds]
      );
      if (ledgerResult.rows.length !== ledgerEntryIds.length) {
        throw new ValidationError('One or more ledger entries were not found for this tenant');
      }
    }

    await client.query(
      `DELETE FROM transaction_splits
       WHERE tenant_id = $1 AND bank_transaction_id = $2`,
      [tenantId, bankTransactionId]
    );

    for (const split of sanitizedSplits) {
      await client.query(
        `INSERT INTO transaction_splits (
            tenant_id,
            bank_transaction_id,
            status,
            split_amount,
            currency,
            document_id,
            ledger_entry_id,
            memo,
            tags,
            confidence_score,
            created_by,
            updated_by
        ) VALUES ($1, $2, 'draft', $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $10)`,
        [
          tenantId,
          bankTransactionId,
          split.amount,
          split.currency,
          split.documentId,
          split.ledgerEntryId,
          split.memo,
          JSON.stringify(split.tags),
          split.confidenceScore,
          userId,
        ]
      );
    }

    const remainingAmount = Math.abs(transactionAmount - totalSplitAmount) <= AMOUNT_TOLERANCE
      ? 0
      : transactionAmount - totalSplitAmount;

    await client.query(
      `UPDATE bank_transactions
       SET is_split = true,
           split_status = 'balanced',
           split_remaining_amount = $1,
           split_submitted_by = NULL,
           split_submitted_at = NULL,
           split_review_notes = NULL,
           updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [remainingAmount, bankTransactionId, tenantId]
    );
    logger.info('Transaction splits replaced', {
      bankTransactionId,
      tenantId,
      splitCount: sanitizedSplits.length,
    });
  });

  return getTransactionSplits(tenantId, bankTransactionId);
}

export async function deleteTransactionSplits(
  tenantId: TenantId,
  bankTransactionId: string
): Promise<void> {
  await db.transaction(async (client) => {
    const transactionResult = await client.query<{ id: string }>(
      `SELECT id
       FROM bank_transactions
       WHERE id = $1 AND tenant_id = $2
       FOR UPDATE`,
      [bankTransactionId, tenantId]
    );

    if (transactionResult.rows.length === 0) {
      throw new ValidationError('Bank transaction not found');
    }

    await client.query(
      `DELETE FROM transaction_splits
       WHERE tenant_id = $1 AND bank_transaction_id = $2`,
      [tenantId, bankTransactionId]
    );

    await client.query(
      `UPDATE bank_transactions
       SET is_split = false,
           split_status = 'not_split',
           split_remaining_amount = NULL,
           split_submitted_by = NULL,
           split_submitted_at = NULL,
           split_review_notes = NULL,
           updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [bankTransactionId, tenantId]
    );
  });

  logger.info('Transaction splits cleared', { bankTransactionId, tenantId });
}

function approvalRequired(): boolean {
  return process.env.RECON_SPLIT_APPROVAL_REQUIRED !== 'false';
}

async function insertAuditLog(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  tenantId: TenantId,
  userId: UserId,
  action: string,
  resourceType: string,
  resourceId: string,
  changes: Record<string, unknown>
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (
        tenant_id, user_id, action, resource_type, resource_id, changes, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
    [tenantId, userId, action, resourceType, resourceId, JSON.stringify(changes)]
  );
}

async function publishSplitEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  logger.info(`Split event: ${eventType}`, payload);
}

export async function submitTransactionSplits(
  tenantId: TenantId,
  bankTransactionId: string,
  userId: UserId
): Promise<TransactionSplitSummary> {
  await db.transaction(async (client) => {
    const transactionResult = await client.query<{
      split_status: string;
      split_remaining_amount: string | null;
      is_split: boolean;
      reconciled: boolean;
    }>(
      `SELECT split_status, split_remaining_amount::text, is_split, reconciled
       FROM bank_transactions
       WHERE id = $1 AND tenant_id = $2
       FOR UPDATE`,
      [bankTransactionId, tenantId]
    );

    const transaction = transactionResult.rows[0];
    if (!transaction) {
      throw new ValidationError('Bank transaction not found');
    }
    if (!transaction.is_split) {
      throw new ValidationError('No splits exist for this transaction');
    }
    if (transaction.reconciled) {
      throw new ValidationError('Transaction already reconciled');
    }
    if (transaction.split_status === 'pending_review') {
      throw new ValidationError('Splits are already pending review');
    }

    const remaining = transaction.split_remaining_amount ? parseFloat(transaction.split_remaining_amount) : 0;
    if (Math.abs(remaining) > AMOUNT_TOLERANCE) {
      throw new ValidationError('Splits must balance to the transaction total before submission');
    }

    await client.query(
      `UPDATE transaction_splits
       SET status = 'pending_review',
           review_notes = NULL,
           updated_at = NOW()
       WHERE tenant_id = $1 AND bank_transaction_id = $2`,
      [tenantId, bankTransactionId]
    );

    await client.query(
      `UPDATE bank_transactions
       SET split_status = 'pending_review',
           split_submitted_by = $1,
           split_submitted_at = NOW(),
           split_review_notes = NULL,
           updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [userId, bankTransactionId, tenantId]
    );

    await insertAuditLog(client, tenantId, userId, 'split_submitted', 'bank_transaction', bankTransactionId, {
      status: { old: transaction.split_status, new: 'pending_review' },
    });
  });

  await publishSplitEvent('submitted', { tenantId, bankTransactionId, userId });

  if (!approvalRequired()) {
    return approveTransactionSplits(tenantId, bankTransactionId, userId, {
      autoApproved: true,
      reviewerNotes: null,
    });
  }

  return getTransactionSplits(tenantId, bankTransactionId);
}

interface ApproveOptions {
  autoApproved?: boolean;
  reviewerNotes?: string | null;
}

export async function approveTransactionSplits(
  tenantId: TenantId,
  bankTransactionId: string,
  userId: UserId,
  options: ApproveOptions = {}
): Promise<TransactionSplitSummary> {
  await applyTransactionSplits(tenantId, bankTransactionId, userId, options);
  await publishSplitEvent('approved', { tenantId, bankTransactionId, userId, auto: options.autoApproved ?? false });
  await resolveExceptionsForTransaction(tenantId, bankTransactionId);
  return getTransactionSplits(tenantId, bankTransactionId);
}

export async function rejectTransactionSplits(
  tenantId: TenantId,
  bankTransactionId: string,
  userId: UserId,
  reason?: string
): Promise<TransactionSplitSummary> {
  await db.transaction(async (client) => {
    const transactionResult = await client.query<{ split_status: string }>(
      `SELECT split_status
       FROM bank_transactions
       WHERE id = $1 AND tenant_id = $2
       FOR UPDATE`,
      [bankTransactionId, tenantId]
    );

    const transaction = transactionResult.rows[0];
    if (!transaction) {
      throw new ValidationError('Bank transaction not found');
    }
    if (transaction.split_status !== 'pending_review') {
      throw new ValidationError('Only pending review splits can be rejected');
    }

    await client.query(
      `UPDATE transaction_splits
       SET status = 'draft',
           review_notes = $1,
           updated_at = NOW()
       WHERE tenant_id = $2 AND bank_transaction_id = $3`,
      [reason || null, tenantId, bankTransactionId]
    );

    await client.query(
      `UPDATE bank_transactions
       SET split_status = 'draft',
           split_submitted_by = NULL,
           split_submitted_at = NULL,
           split_review_notes = $1,
           updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [reason || null, bankTransactionId, tenantId]
    );

    await insertAuditLog(client, tenantId, userId, 'split_rejected', 'bank_transaction', bankTransactionId, {
      status: { old: 'pending_review', new: 'draft' },
      reason: reason || null,
    });
  });

  await publishSplitEvent('rejected', { tenantId, bankTransactionId, userId, reason: reason || null });
  return getTransactionSplits(tenantId, bankTransactionId);
}

async function applyTransactionSplits(
  tenantId: TenantId,
  bankTransactionId: string,
  userId: UserId,
  options: ApproveOptions
): Promise<void> {
  await db.transaction(async (client) => {
    const transactionResult = await client.query<{
      id: string;
      amount: string;
      currency: string;
      is_split: boolean;
      split_status: string;
      reconciled: boolean;
    }>(
      `SELECT id,
              amount::text,
              currency,
              is_split,
              split_status,
              reconciled
       FROM bank_transactions
       WHERE id = $1 AND tenant_id = $2
       FOR UPDATE`,
      [bankTransactionId, tenantId]
    );

    const transaction = transactionResult.rows[0];
    if (!transaction) {
      throw new ValidationError('Bank transaction not found');
    }
    if (!transaction.is_split) {
      throw new ValidationError('No splits to apply for this transaction');
    }
    if (transaction.reconciled) {
      throw new ValidationError('Transaction already reconciled');
    }
    if (!['balanced', 'pending_review'].includes(transaction.split_status)) {
      throw new ValidationError('Splits must be balanced or pending review before applying');
    }

    const splitsResult = await client.query<{
      id: string;
      split_amount: string;
      currency: string;
      document_id: string | null;
      ledger_entry_id: string | null;
      status: AllowedSplitStatus;
    }>(
      `SELECT id,
              split_amount::text,
              currency,
              document_id,
              ledger_entry_id,
              status
       FROM transaction_splits
       WHERE tenant_id = $1 AND bank_transaction_id = $2
       ORDER BY created_at ASC
       FOR UPDATE`,
      [tenantId, bankTransactionId]
    );

    if (splitsResult.rows.length === 0) {
      throw new ValidationError('No splits found for this transaction');
    }

    const totalSplit = splitsResult.rows.reduce((sum, row) => sum + parseFloat(row.split_amount), 0);
    const transactionAmount = parseFloat(transaction.amount);
    if (Math.abs(transactionAmount - totalSplit) > AMOUNT_TOLERANCE) {
      throw new ValidationError('Splits no longer balance to the transaction amount');
    }

    const documentIds = splitsResult.rows
      .map((row) => row.document_id)
      .filter((id): id is string => Boolean(id));
    const ledgerIds = splitsResult.rows
      .map((row) => row.ledger_entry_id)
      .filter((id): id is string => Boolean(id));

    if (documentIds.length) {
      await client.query(
        `UPDATE documents
         SET status = 'posted',
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, documentIds]
      );
    }

    if (ledgerIds.length) {
      await client.query(
        `UPDATE ledger_entries
         SET reconciled = true,
             reconciled_with = $1,
             updated_at = NOW()
         WHERE tenant_id = $2 AND id = ANY($3::uuid[])`,
        [bankTransactionId, tenantId, ledgerIds]
      );
    }

    await client.query(
      `UPDATE transaction_splits
       SET status = 'applied',
           approved_by = $1,
           approved_at = NOW(),
           review_notes = COALESCE(review_notes, $2),
           updated_at = NOW()
       WHERE tenant_id = $3 AND bank_transaction_id = $4`,
      [userId, options.reviewerNotes || null, tenantId, bankTransactionId]
    );

    await client.query(
      `UPDATE bank_transactions
       SET reconciled = true,
           is_split = true,
           split_status = 'applied',
           split_remaining_amount = 0,
           split_submitted_by = CASE WHEN split_submitted_by IS NULL THEN $1 ELSE split_submitted_by END,
           split_submitted_at = CASE WHEN split_submitted_at IS NULL THEN NOW() ELSE split_submitted_at END,
           split_review_notes = COALESCE(split_review_notes, $2),
           updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4`,
      [userId, options.reviewerNotes || null, bankTransactionId, tenantId]
    );

    await insertAuditLog(client, tenantId, userId, 'split_applied', 'bank_transaction', bankTransactionId, {
      status: { old: transaction.split_status, new: 'applied' },
      auto: options.autoApproved ?? false,
    });
  });
}
