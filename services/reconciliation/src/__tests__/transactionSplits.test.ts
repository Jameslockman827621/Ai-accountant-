import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { db } from '@ai-accountant/database';
import {
  replaceTransactionSplits,
  getTransactionSplits,
  deleteTransactionSplits,
  submitTransactionSplits,
  approveTransactionSplits,
  rejectTransactionSplits,
} from '../services/transactionSplits';
import { ValidationError } from '@ai-accountant/shared-utils';

describe('Transaction split service', () => {
  let tenantId: string;
  let userId: string;
  let documentId: string;
  let ledgerEntryId: string;
  let bankTransactionId: string;
  const originalApprovalEnv = process.env.RECON_SPLIT_APPROVAL_REQUIRED;

  beforeAll(async () => {
    const tenantResult = await db.query<{ id: string }>(
      `INSERT INTO tenants (name, country, subscription_tier)
       VALUES ('Split Test Tenant', 'GB', 'freelancer')
       RETURNING id`
    );
    tenantId = tenantResult.rows[0]?.id as string;

    const userResult = await db.query<{ id: string }>(
      `INSERT INTO users (
        tenant_id, email, name, password_hash, role, is_active, email_verified
      ) VALUES ($1, 'split-test@example.com', 'Split Tester', 'hash', 'accountant', true, true)
      RETURNING id`,
      [tenantId]
    );
    userId = userResult.rows[0]?.id as string;
    process.env.RECON_SPLIT_APPROVAL_REQUIRED = 'true';
  });

  afterAll(async () => {
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    await db.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    await db.close();
    process.env.RECON_SPLIT_APPROVAL_REQUIRED = originalApprovalEnv;
  });

  beforeEach(async () => {
    const transactionResult = await db.query<{ id: string }>(
      `INSERT INTO bank_transactions (
        tenant_id, account_id, transaction_id, date, amount, currency, description, reconciled
      ) VALUES ($1, 'acct-split', uuid_generate_v4()::text, NOW(), 100.00, 'GBP', 'Split Test Transaction', false)
      RETURNING id`,
      [tenantId]
    );
    bankTransactionId = transactionResult.rows[0]?.id as string;

    const documentResult = await db.query<{ id: string }>(
      `INSERT INTO documents (
        tenant_id, uploaded_by, file_name, file_type, file_size, storage_key, status
      ) VALUES ($1, $2, 'test.pdf', 'application/pdf', 123, 'test-key', 'posted')
      RETURNING id`,
      [tenantId, userId]
    );
    documentId = documentResult.rows[0]?.id as string;

    const ledgerResult = await db.query<{ id: string }>(
      `INSERT INTO ledger_entries (
        tenant_id, entry_type, account_code, account_name, amount, currency, description, transaction_date, reconciled
      ) VALUES ($1, 'debit', '6000', 'Expenses', 40.00, 'GBP', 'Split Ledger Entry', NOW(), false)
      RETURNING id`,
      [tenantId]
    );
    ledgerEntryId = ledgerResult.rows[0]?.id as string;
  });

  afterEach(async () => {
    await db.query('DELETE FROM transaction_splits WHERE bank_transaction_id = $1', [bankTransactionId]);
    await db.query('DELETE FROM bank_transactions WHERE id = $1', [bankTransactionId]);
    await db.query('DELETE FROM documents WHERE id = $1', [documentId]);
    await db.query('DELETE FROM ledger_entries WHERE id = $1', [ledgerEntryId]);
  });

  it('creates and retrieves splits', async () => {
    const summary = await replaceTransactionSplits(
      tenantId,
      bankTransactionId,
      userId,
      [
        { amount: 60, documentId, memo: 'Document split' },
        { amount: 40, ledgerEntryId, memo: 'Ledger split' },
      ]
    );

    expect(summary.splits).toHaveLength(2);
    expect(summary.splitRemainingAmount).toBeCloseTo(0);
    expect(summary.isSplit).toBe(true);

    const fetched = await getTransactionSplits(tenantId, bankTransactionId);
    expect(fetched.splits).toHaveLength(2);
    expect(fetched.amount).toEqual(100);
  });

  it('rejects mismatched totals', async () => {
    await expect(
      replaceTransactionSplits(
        tenantId,
        bankTransactionId,
        userId,
        [{ amount: 10, documentId }]
      )
    ).rejects.toThrow(ValidationError);
  });

  it('deletes splits and resets state', async () => {
    await replaceTransactionSplits(
      tenantId,
      bankTransactionId,
      userId,
      [
        { amount: 60, documentId },
        { amount: 40, ledgerEntryId },
      ]
    );

    await deleteTransactionSplits(tenantId, bankTransactionId);

    const fetched = await getTransactionSplits(tenantId, bankTransactionId);
    expect(fetched.splits).toHaveLength(0);
    expect(fetched.isSplit).toBe(false);
    expect(fetched.splitRemainingAmount).toEqual(100);
  });

  it('submits splits for review and approves them', async () => {
    await replaceTransactionSplits(
      tenantId,
      bankTransactionId,
      userId,
      [
        { amount: 60, documentId },
        { amount: 40, ledgerEntryId },
      ]
    );

    const submitted = await submitTransactionSplits(tenantId, bankTransactionId, userId);
    expect(submitted.status).toBe('pending_review');
    expect(submitted.submittedBy).toEqual(userId);

    await approveTransactionSplits(tenantId, bankTransactionId, userId, { reviewerNotes: 'looks good' });

    const txResult = await db.query<{ reconciled: boolean; split_status: string }>(
      `SELECT reconciled, split_status
       FROM bank_transactions
       WHERE id = $1`,
      [bankTransactionId]
    );
    expect(txResult.rows[0]?.reconciled).toBe(true);
    expect(txResult.rows[0]?.split_status).toBe('applied');
  });

  it('auto-approves splits when approval disabled', async () => {
    process.env.RECON_SPLIT_APPROVAL_REQUIRED = 'false';

    await replaceTransactionSplits(
      tenantId,
      bankTransactionId,
      userId,
      [
        { amount: 70, documentId },
        { amount: 30, ledgerEntryId },
      ]
    );

    const summary = await submitTransactionSplits(tenantId, bankTransactionId, userId);
    expect(summary.status).toBe('applied');

    process.env.RECON_SPLIT_APPROVAL_REQUIRED = 'true';
  });

  it('rejects splits back to draft', async () => {
    await replaceTransactionSplits(
      tenantId,
      bankTransactionId,
      userId,
      [
        { amount: 60, documentId },
        { amount: 40, ledgerEntryId },
      ]
    );

    await submitTransactionSplits(tenantId, bankTransactionId, userId);
    const summary = await rejectTransactionSplits(tenantId, bankTransactionId, userId, 'Incorrect allocation');

    expect(summary.status).toBe('draft');
    expect(summary.reviewNotes).toBe('Incorrect allocation');
    expect(summary.submittedBy).toBeNull();
  });
});
