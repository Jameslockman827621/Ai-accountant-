import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

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
}

export interface LedgerEntry {
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
      description, transaction_date, tax_amount, tax_rate
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
    ]
  );

  return entryId;
}

export async function getLedgerEntries(
  tenantId: TenantId,
  filters: {
    startDate?: Date;
    endDate?: Date;
    accountCode?: string;
    entryType?: 'debit' | 'credit';
  }
): Promise<LedgerEntry[]> {
  let query = 'SELECT * FROM ledger_entries WHERE tenant_id = $1';
  const params: unknown[] = [tenantId];

  if (filters.startDate) {
    query += ` AND transaction_date >= $${params.length + 1}`;
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    query += ` AND transaction_date <= $${params.length + 1}`;
    params.push(filters.endDate);
  }

  if (filters.accountCode) {
    query += ` AND account_code = $${params.length + 1}`;
    params.push(filters.accountCode);
  }

  if (filters.entryType) {
    query += ` AND entry_type = $${params.length + 1}`;
    params.push(filters.entryType);
  }

  query += ' ORDER BY transaction_date DESC';

  const result = await db.query<LedgerEntry>(query, params);
  return result.rows;
}
