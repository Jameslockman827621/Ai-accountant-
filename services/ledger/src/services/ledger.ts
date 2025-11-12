import { randomUUID } from 'crypto';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { LedgerEntry, LedgerEntryType, TenantId, UserId } from '@ai-accountant/shared-types';
import { ValidationError } from '@ai-accountant/shared-utils';

const logger = createLogger('ledger-service');

export interface CreateLedgerEntryInput {
  documentId?: string;
  entryType: LedgerEntryType;
  accountCode: string;
  accountName: string;
  amount: number;
  currency: string;
  description: string;
  transactionDate: Date;
  taxAmount?: number;
  taxRate?: number;
  metadata?: Record<string, unknown>;
  createdBy: UserId | 'system';
  modelVersion?: string;
  reasoningTrace?: string;
}

export async function createLedgerEntry(
  tenantId: TenantId,
  input: CreateLedgerEntryInput
): Promise<LedgerEntry> {
  // Validate double-entry accounting: ensure debits equal credits for the transaction
  // This is a simplified version - in production, you'd want to ensure pairs are created together

  const entryId = randomUUID();

  const result = await db.query<Record<string, unknown>>(
    `INSERT INTO ledger_entries (
      id, tenant_id, document_id, entry_type, account_code, account_name,
      amount, currency, description, transaction_date, tax_amount, tax_rate,
      metadata, created_by, model_version, reasoning_trace
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *`,
    [
      entryId,
      tenantId,
      input.documentId || null,
      input.entryType,
      input.accountCode,
      input.accountName,
      input.amount,
      input.currency,
      input.description,
      input.transactionDate,
      input.taxAmount || null,
      input.taxRate || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.createdBy,
      input.modelVersion || null,
      input.reasoningTrace || null,
    ]
  );

  logger.info('Ledger entry created', { entryId, tenantId });

  const entry = result.rows[0];
  if (!entry) {
    throw new Error('Failed to create ledger entry');
  }
  return entry as unknown as LedgerEntry;
}

export async function getLedgerEntries(
  tenantId: TenantId,
  filters: {
    startDate?: Date;
    endDate?: Date;
    accountCode?: string;
    reconciled?: boolean;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ entries: LedgerEntry[]; total: number }> {
  const conditions: string[] = ['tenant_id = $1'];
  const params: unknown[] = [tenantId];
  let paramCount = 2;

  if (filters.startDate) {
    conditions.push(`transaction_date >= $${paramCount++}`);
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    conditions.push(`transaction_date <= $${paramCount++}`);
    params.push(filters.endDate);
  }

  if (filters.accountCode) {
    conditions.push(`account_code = $${paramCount++}`);
    params.push(filters.accountCode);
  }

  if (filters.reconciled !== undefined) {
    conditions.push(`reconciled = $${paramCount++}`);
    params.push(filters.reconciled);
  }

  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  const entriesResult = await db.query<Record<string, unknown>>(
    `SELECT * FROM ledger_entries
     WHERE ${conditions.join(' AND ')}
     ORDER BY transaction_date DESC, created_at DESC
     LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
    [...params, limit, offset]
  );

  const countResult = await db.query<{ total: string | number }>(
    `SELECT COUNT(*) as total FROM ledger_entries WHERE ${conditions.join(' AND ')}`,
    params
  );

  return {
    entries: entriesResult.rows as unknown as LedgerEntry[],
    total: parseInt(String(countResult.rows[0]?.total || '0'), 10),
  };
}

export async function reconcileEntries(
  tenantId: TenantId,
  entryId1: string,
  entryId2: string
): Promise<void> {
  // Verify both entries belong to tenant
  const entries = await db.query<{
    id: string;
    amount: number;
    entry_type: string;
  }>(
    `SELECT id, amount, entry_type FROM ledger_entries
     WHERE id IN ($1, $2) AND tenant_id = $3`,
    [entryId1, entryId2, tenantId]
  );

  if (entries.rows.length !== 2) {
    throw new ValidationError('One or both entries not found');
  }

  const entry1 = entries.rows[0];
  const entry2 = entries.rows[1];
  
  if (!entry1 || !entry2) {
    throw new ValidationError('One or both entries not found');
  }

  // Verify entries balance (one debit, one credit with same amount)
  if (
    entry1.entry_type === entry2.entry_type ||
    Math.abs(entry1.amount - entry2.amount) > 0.01
  ) {
    throw new ValidationError('Entries do not balance for reconciliation');
  }

  // Update reconciliation status
  await db.query(
    `UPDATE ledger_entries
     SET reconciled = true, reconciled_with = $1, updated_at = NOW()
     WHERE id = $2`,
    [entryId2, entryId1]
  );

  await db.query(
    `UPDATE ledger_entries
     SET reconciled = true, reconciled_with = $1, updated_at = NOW()
     WHERE id = $2`,
    [entryId1, entryId2]
  );

  logger.info('Entries reconciled', { entryId1, entryId2, tenantId });
}

export async function getAccountBalance(
  tenantId: TenantId,
  accountCode: string,
  asOfDate?: Date
): Promise<{ balance: number; debitTotal: number; creditTotal: number }> {
  const conditions: string[] = ['tenant_id = $1', 'account_code = $2'];
  const params: unknown[] = [tenantId, accountCode];

  if (asOfDate) {
    conditions.push('transaction_date <= $3');
    params.push(asOfDate);
  }

  const result = await db.query<{
    debit_total: string | number;
    credit_total: string | number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END), 0) as debit_total,
       COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END), 0) as credit_total
     FROM ledger_entries
     WHERE ${conditions.join(' AND ')}`,
    params
  );

  const row = result.rows[0];
  if (!row) {
    return { balance: 0, debitTotal: 0, creditTotal: 0 };
  }
  const debitTotal = typeof row.debit_total === 'number' ? row.debit_total : parseFloat(String(row.debit_total || '0'));
  const creditTotal = typeof row.credit_total === 'number' ? row.credit_total : parseFloat(String(row.credit_total || '0'));

  // For asset/expense accounts: balance = debits - credits
  // For liability/equity/revenue accounts: balance = credits - debits
  // This is simplified - in production, check account type from chart of accounts
  const balance = debitTotal - creditTotal;

  return { balance, debitTotal, creditTotal };
}
