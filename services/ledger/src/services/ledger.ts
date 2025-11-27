import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { ValidationError } from '@ai-accountant/shared-utils';
import { cacheStrategy } from '../../cache/src/cacheStrategy';

export interface CreateLedgerEntryInput {
  tenantId: TenantId;
  entryType: 'debit' | 'credit';
  amount: number;
  accountCode: string;
  accountName: string;
  description: string;
  transactionDate: Date;
  taxAmount?: number;
  taxRate?: number;
  documentId?: string;
  createdBy?: string;
  metadata?: Record<string, unknown>;
  modelVersion?: string;
  reasoningTrace?: string;
}

export interface LedgerEntry extends Record<string, unknown> {
  id: string;
  tenantId: TenantId;
  entryType: 'debit' | 'credit';
  amount: number;
  accountCode: string;
  accountName: string;
  description: string;
  transactionDate: Date;
  taxAmount?: number;
  taxRate?: number;
}

export async function createLedgerEntry(input: CreateLedgerEntryInput): Promise<string> {
  const entryId = randomUUID();

  await db.query(
    `INSERT INTO ledger_entries (
      id, tenant_id, entry_type, amount, account_code, account_name,
      description, transaction_date, tax_amount, tax_rate, document_id,
      created_by, metadata, model_version, reasoning_trace
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15)`,
    [
      entryId,
      input.tenantId,
      input.entryType,
      input.amount,
      input.accountCode,
      input.accountName,
      input.description,
      input.transactionDate,
      input.taxAmount || null,
      input.taxRate || null,
      input.documentId || null,
      input.createdBy || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.modelVersion || null,
      input.reasoningTrace || null,
    ]
  );

  await cacheStrategy.invalidate(`ledger_entries:${input.tenantId}:*`);
  await cacheStrategy.invalidate(`ledger_balance:${input.tenantId}:*`);

  return entryId;
}

export async function getLedgerEntries(
  tenantId: TenantId,
  filters: {
    startDate?: Date;
    endDate?: Date;
    accountCode?: string;
    entryType?: 'debit' | 'credit';
    reconciled?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<{ entries: LedgerEntry[]; total: number }> {
  const cached = await cacheStrategy.getLedgerEntriesCache(tenantId, filters);
  if (cached) {
    return cached as { entries: LedgerEntry[]; total: number };
  }

  let query = 'SELECT * FROM ledger_entries WHERE tenant_id = $1';
  const params: unknown[] = [tenantId];
  let paramCount = 2;

  if (filters.startDate) {
    query += ` AND transaction_date >= $${paramCount++}`;
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    query += ` AND transaction_date <= $${paramCount++}`;
    params.push(filters.endDate);
  }

  if (filters.accountCode) {
    query += ` AND account_code = $${paramCount++}`;
    params.push(filters.accountCode);
  }

  if (filters.entryType) {
    query += ` AND entry_type = $${paramCount++}`;
    params.push(filters.entryType);
  }

  if (filters.reconciled !== undefined) {
    query += ` AND reconciled = $${paramCount++}`;
    params.push(filters.reconciled);
  }

  // Get total count
  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
  const countResult = await db.query<{ total: string | number }>(countQuery, params);
  const total =
    typeof countResult.rows[0]?.total === 'number'
      ? countResult.rows[0].total
      : parseInt(String(countResult.rows[0]?.total || '0'), 10);

  // Apply pagination
  query += ' ORDER BY transaction_date DESC';
  if (filters.limit) {
    query += ` LIMIT $${paramCount++}`;
    params.push(filters.limit);
  }
  if (filters.offset) {
    query += ` OFFSET $${paramCount++}`;
    params.push(filters.offset);
  }

  const result = await db.query<LedgerEntry>(query, params);
  const payload = { entries: result.rows, total };
  await cacheStrategy.setLedgerEntriesCache(tenantId, filters, payload);
  return payload;
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
  }>('SELECT id, amount, entry_type FROM ledger_entries WHERE id IN ($1, $2) AND tenant_id = $3', [
    entryId1,
    entryId2,
    tenantId,
  ]);

  if (entries.rows.length !== 2) {
    throw new ValidationError('One or both entries not found');
  }

  const entry1 = entries.rows.find((e) => e.id === entryId1);
  const entry2 = entries.rows.find((e) => e.id === entryId2);

  if (!entry1 || !entry2) {
    throw new ValidationError('Entries not found');
  }

  // Verify entries are opposite types
  if (entry1.entry_type === entry2.entry_type) {
    throw new ValidationError('Cannot reconcile entries of the same type');
  }

  // Verify amounts match (within tolerance)
  if (Math.abs(entry1.amount - entry2.amount) > 0.01) {
    throw new ValidationError('Entry amounts do not match');
  }

  // Mark as reconciled
  await db.query(
    `UPDATE ledger_entries
     SET reconciled = true,
         reconciled_with = $1,
         updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [entryId2, entryId1, tenantId]
  );

  await db.query(
    `UPDATE ledger_entries
     SET reconciled = true,
         reconciled_with = $1,
         updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3`,
    [entryId1, entryId2, tenantId]
  );

  await cacheStrategy.invalidate(`ledger_entries:${tenantId}:*`);
  await cacheStrategy.invalidate(`ledger_balance:${tenantId}:*`);
}

export async function getAccountBalance(
  tenantId: TenantId,
  accountCode: string,
  asOfDate?: Date
): Promise<{
  accountCode: string;
  accountName: string;
  balance: number;
  debitTotal: number;
  creditTotal: number;
  asOfDate: Date;
}> {
  const cached = await cacheStrategy.getLedgerBalanceCache(
    tenantId,
    accountCode,
    asOfDate ? asOfDate.toISOString() : undefined
  );
  if (cached) {
    return cached as {
      accountCode: string;
      accountName: string;
      balance: number;
      debitTotal: number;
      creditTotal: number;
      asOfDate: Date;
    };
  }

  let query = `
    SELECT
      account_code,
      account_name,
      SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE -amount END) as balance,
      SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as debit_total,
      SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as credit_total
    FROM ledger_entries
    WHERE tenant_id = $1 AND account_code = $2
  `;
  const params: unknown[] = [tenantId, accountCode];

  if (asOfDate) {
    query += ' AND transaction_date <= $3';
    params.push(asOfDate);
  }

  query += ' GROUP BY account_code, account_name';

  const result = await db.query<{
    account_code: string;
    account_name: string;
    balance: string | number;
    debit_total: string | number;
    credit_total: string | number;
  }>(query, params);

  if (result.rows.length === 0) {
    throw new ValidationError('Account not found or has no entries');
  }

  const row = result.rows[0];
  if (!row) {
    throw new ValidationError('Account not found or has no entries');
  }
  const payload = {
    accountCode: row.account_code,
    accountName: row.account_name,
    balance: typeof row.balance === 'number' ? row.balance : parseFloat(String(row.balance || '0')),
    debitTotal:
      typeof row.debit_total === 'number'
        ? row.debit_total
        : parseFloat(String(row.debit_total || '0')),
    creditTotal:
      typeof row.credit_total === 'number'
        ? row.credit_total
        : parseFloat(String(row.credit_total || '0')),
    asOfDate: asOfDate || new Date(),
  };

  await cacheStrategy.setLedgerBalanceCache(
    tenantId,
    accountCode,
    payload,
    asOfDate ? asOfDate.toISOString() : undefined
  );

  return payload;
}
