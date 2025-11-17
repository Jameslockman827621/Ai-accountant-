import { db } from '@ai-accountant/database';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

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
}

export interface TransactionSplitSummary {
  transactionId: string;
  amount: number;
  currency: string;
  status: string;
  isSplit: boolean;
  splitRemainingAmount: number | null;
  splits: TransactionSplitResponse[];
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
  }>(
    `SELECT id, amount::text, currency, is_split, split_status, split_remaining_amount::text
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
           updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [bankTransactionId, tenantId]
    );
  });

  logger.info('Transaction splits cleared', { bankTransactionId, tenantId });
}
