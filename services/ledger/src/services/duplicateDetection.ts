import { db } from '@ai-accountant/database';
import { TenantId } from '@ai-accountant/shared-types';

export interface LedgerDuplicateCandidate {
  entryId: string;
  amount: number;
  transactionDate: string;
  accountCode: string;
  similarity: number;
  reason: string;
  documentId?: string | null;
}

export async function detectDuplicateLedgerEntries(
  tenantId: TenantId,
  entryId: string
): Promise<LedgerDuplicateCandidate[]> {
  const entryResult = await db.query<{
    id: string;
    amount: string | number;
    transaction_date: Date;
    account_code: string;
    document_id: string | null;
    description: string;
  }>(
    `SELECT id, amount, transaction_date, account_code, document_id, description
     FROM ledger_entries
     WHERE id = $1 AND tenant_id = $2`,
    [entryId, tenantId]
  );

  if (entryResult.rows.length === 0) {
    return [];
  }

  const entry = entryResult.rows[0];
  const amount = typeof entry.amount === 'number' ? entry.amount : parseFloat(String(entry.amount || '0'));
  const transactionDate = entry.transaction_date;

  const candidates: LedgerDuplicateCandidate[] = [];

  const neighborMatches = await db.query<{
    id: string;
    amount: string | number;
    transaction_date: Date;
    account_code: string;
    document_id: string | null;
  }>(
    `SELECT id, amount, transaction_date, account_code, document_id
       FROM ledger_entries
      WHERE tenant_id = $1
        AND id <> $2
        AND account_code = $3
        AND transaction_date BETWEEN $4::date - INTERVAL '1 day' AND $4::date + INTERVAL '1 day'
        AND ABS(amount - $5) < 0.01`,
    [tenantId, entryId, entry.account_code, transactionDate, amount]
  );

  for (const match of neighborMatches.rows) {
    candidates.push({
      entryId: match.id,
      amount: typeof match.amount === 'number' ? match.amount : parseFloat(String(match.amount || '0')),
      transactionDate: match.transaction_date.toISOString(),
      accountCode: match.account_code,
      similarity: 0.95,
      documentId: match.document_id,
      reason: 'Same amount, account, and adjacent date',
    });
  }

  if (entry.document_id) {
    const documentMatches = await db.query<{ id: string; account_code: string; transaction_date: Date; amount: string | number }>(
      `SELECT id, account_code, transaction_date, amount
       FROM ledger_entries
       WHERE tenant_id = $1 AND id <> $2 AND document_id = $3`,
      [tenantId, entryId, entry.document_id]
    );

    for (const match of documentMatches.rows) {
      candidates.push({
        entryId: match.id,
        amount: typeof match.amount === 'number' ? match.amount : parseFloat(String(match.amount || '0')),
        transactionDate: match.transaction_date.toISOString(),
        accountCode: match.account_code,
        similarity: 1,
        documentId: entry.document_id,
        reason: 'Shared source document',
      });
    }
  }

  const descriptionMatches = await db.query<{ id: string; amount: string | number; transaction_date: Date; account_code: string }>(
    `SELECT id, amount, transaction_date, account_code
       FROM ledger_entries
      WHERE tenant_id = $1
        AND id <> $2
        AND description = $3
        AND ABS(amount - $4) < 0.5`,
    [tenantId, entryId, entry.description, amount]
  );

  for (const match of descriptionMatches.rows) {
    if (!candidates.find((c) => c.entryId === match.id)) {
      candidates.push({
        entryId: match.id,
        amount: typeof match.amount === 'number' ? match.amount : parseFloat(String(match.amount || '0')),
        transactionDate: match.transaction_date.toISOString(),
        accountCode: match.account_code,
        similarity: 0.75,
        reason: 'Matching description and near-identical amount',
      });
    }
  }

  return candidates.sort((a, b) => b.similarity - a.similarity);
}
