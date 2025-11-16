import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';

const logger = createLogger('validation-service');

export interface CrossValidationResult {
  source: 'bank' | 'document' | 'ledger';
  itemId: string;
  date: Date;
  amount: number;
  description: string;
  matched: boolean;
  matchedWith?: string[];
  discrepancy?: {
    type: 'amount' | 'date' | 'missing' | 'duplicate';
    details: string;
  };
}

export interface CrossValidationReport {
  tenantId: TenantId;
  periodStart: Date;
  periodEnd: Date;
  totalItems: number;
  matchedItems: number;
  unmatchedItems: number;
  discrepancies: CrossValidationResult[];
  summary: {
    bankTransactions: number;
    documents: number;
    ledgerEntries: number;
    matchRate: number;
  };
}

/**
 * Cross-validate data from all sources: bank feeds, documents, and ledger entries
 * This ensures data consistency across the entire system
 */
export async function crossValidateData(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<CrossValidationReport> {
  logger.info('Starting cross-validation', { tenantId, periodStart, periodEnd });

  // Fetch data from all sources
  const [bankTransactions, documents, ledgerEntries] = await Promise.all([
    fetchBankTransactions(tenantId, periodStart, periodEnd),
    fetchDocuments(tenantId, periodStart, periodEnd),
    fetchLedgerEntries(tenantId, periodStart, periodEnd),
  ]);

  const discrepancies: CrossValidationResult[] = [];
  const matchedItems = new Set<string>();

  // Match bank transactions with documents and ledger entries
  for (const bankTx of bankTransactions) {
    const bankKey = `${bankTx.date.toISOString()}_${bankTx.amount}`;
    
    // Try to match with documents
    const matchingDoc = documents.find(
      doc => 
        Math.abs(doc.amount - bankTx.amount) < 0.01 &&
        Math.abs(doc.date.getTime() - bankTx.date.getTime()) < 7 * 24 * 60 * 60 * 1000 // 7 days tolerance
    );

    // Try to match with ledger entries
    const matchingLedger = ledgerEntries.find(
      entry =>
        Math.abs(entry.amount - bankTx.amount) < 0.01 &&
        Math.abs(entry.transactionDate.getTime() - bankTx.date.getTime()) < 7 * 24 * 60 * 60 * 1000
    );

    if (matchingDoc && matchingLedger) {
      matchedItems.add(bankKey);
      matchedItems.add(`doc_${matchingDoc.id}`);
      matchedItems.add(`ledger_${matchingLedger.id}`);
    } else if (!matchingDoc && !matchingLedger) {
      discrepancies.push({
        source: 'bank',
        itemId: bankTx.id,
        date: bankTx.date,
        amount: bankTx.amount,
        description: bankTx.description,
        matched: false,
        discrepancy: {
          type: 'missing',
          details: 'Bank transaction has no matching document or ledger entry',
        },
      });
    } else if (matchingDoc && !matchingLedger) {
      discrepancies.push({
        source: 'bank',
        itemId: bankTx.id,
        date: bankTx.date,
        amount: bankTx.amount,
        description: bankTx.description,
        matched: false,
        matchedWith: [`doc_${matchingDoc.id}`],
        discrepancy: {
          type: 'missing',
          details: 'Bank transaction has document but no ledger entry',
        },
      });
    }
  }

  // Check for documents without bank transactions or ledger entries
  for (const doc of documents) {
    const docKey = `doc_${doc.id}`;
    if (!matchedItems.has(docKey)) {
      const matchingBank = bankTransactions.find(
        tx =>
          Math.abs(tx.amount - doc.amount) < 0.01 &&
          Math.abs(tx.date.getTime() - doc.date.getTime()) < 7 * 24 * 60 * 60 * 1000
      );

      const matchingLedger = ledgerEntries.find(
        entry =>
          Math.abs(entry.amount - doc.amount) < 0.01 &&
          Math.abs(entry.transactionDate.getTime() - doc.date.getTime()) < 7 * 24 * 60 * 60 * 1000
      );

      if (!matchingBank && !matchingLedger) {
        discrepancies.push({
          source: 'document',
          itemId: doc.id,
          date: doc.date,
          amount: doc.amount,
          description: doc.description || 'Document',
          matched: false,
          discrepancy: {
            type: 'missing',
            details: 'Document has no matching bank transaction or ledger entry',
          },
        });
      }
    }
  }

  // Check for ledger entries without documents or bank transactions
  for (const entry of ledgerEntries) {
    const ledgerKey = `ledger_${entry.id}`;
    if (!matchedItems.has(ledgerKey)) {
      const matchingDoc = documents.find(
        doc =>
          Math.abs(doc.amount - entry.amount) < 0.01 &&
          Math.abs(doc.date.getTime() - entry.transactionDate.getTime()) < 7 * 24 * 60 * 60 * 1000
      );

      const matchingBank = bankTransactions.find(
        tx =>
          Math.abs(tx.amount - entry.amount) < 0.01 &&
          Math.abs(tx.date.getTime() - entry.transactionDate.getTime()) < 7 * 24 * 60 * 60 * 1000
      );

      if (!matchingDoc && !matchingBank && !entry.documentId) {
        discrepancies.push({
          source: 'ledger',
          itemId: entry.id,
          date: entry.transactionDate,
          amount: entry.amount,
          description: entry.description,
          matched: false,
          discrepancy: {
            type: 'missing',
            details: 'Ledger entry has no source document or bank transaction',
          },
        });
      }
    }
  }

  // Detect duplicates
  const duplicateGroups = detectDuplicates([...bankTransactions, ...documents, ...ledgerEntries]);
  for (const group of duplicateGroups) {
    if (group.length > 1) {
      for (const item of group) {
        discrepancies.push({
          source: item.source as 'bank' | 'document' | 'ledger',
          itemId: item.id,
          date: item.date,
          amount: item.amount,
          description: item.description,
          matched: false,
          discrepancy: {
            type: 'duplicate',
            details: `Potential duplicate: ${group.length} similar items found`,
          },
        });
      }
    }
  }

  const totalItems = bankTransactions.length + documents.length + ledgerEntries.length;
  const matchRate = totalItems > 0 ? matchedItems.size / totalItems : 1;

  return {
    tenantId,
    periodStart,
    periodEnd,
    totalItems,
    matchedItems: matchedItems.size,
    unmatchedItems: discrepancies.length,
    discrepancies,
    summary: {
      bankTransactions: bankTransactions.length,
      documents: documents.length,
      ledgerEntries: ledgerEntries.length,
      matchRate,
    },
  };
}

interface DataItem {
  id: string;
  date: Date;
  amount: number;
  description: string;
  source: string;
}

async function fetchBankTransactions(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<DataItem[]> {
  const result = await db.query<{
    id: string;
    date: Date;
    amount: number;
    description: string;
  }>(
    `SELECT id, date, amount, description
     FROM bank_transactions
     WHERE tenant_id = $1
       AND date BETWEEN $2 AND $3
     ORDER BY date, amount`,
    [tenantId, periodStart, periodEnd]
  );

  return result.rows.map(row => ({
    id: row.id,
    date: row.date,
    amount: parseFloat(String(row.amount)),
    description: row.description || '',
    source: 'bank',
  }));
}

async function fetchDocuments(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<DataItem[]> {
  const result = await db.query<{
    id: string;
    created_at: Date;
    extracted_data: Record<string, unknown> | null;
  }>(
    `SELECT id, created_at, extracted_data
     FROM documents
     WHERE tenant_id = $1
       AND created_at BETWEEN $2 AND $3
     ORDER BY created_at`,
    [tenantId, periodStart, periodEnd]
  );

  return result.rows
    .map(row => {
      const extracted = row.extracted_data || {};
      const amount = typeof extracted.total === 'number' 
        ? extracted.total 
        : parseFloat(String(extracted.total || '0'));
      const dateStr = extracted.date as string | undefined;
      const date = dateStr ? new Date(dateStr) : row.created_at;

      return {
        id: row.id,
        date,
        amount,
        description: (extracted.description as string) || (extracted.vendor as string) || 'Document',
        source: 'document',
      };
    })
    .filter(item => item.amount > 0);
}

async function fetchLedgerEntries(
  tenantId: TenantId,
  periodStart: Date,
  periodEnd: Date
): Promise<DataItem[]> {
  const result = await db.query<{
    id: string;
    transaction_date: Date;
    amount: number;
    description: string;
  }>(
    `SELECT id, transaction_date, amount, description
     FROM ledger_entries
     WHERE tenant_id = $1
       AND transaction_date BETWEEN $2 AND $3
     ORDER BY transaction_date, amount`,
    [tenantId, periodStart, periodEnd]
  );

  return result.rows.map(row => ({
    id: row.id,
    date: row.transaction_date,
    amount: parseFloat(String(row.amount)),
    description: row.description || '',
    source: 'ledger',
  }));
}

function detectDuplicates(items: DataItem[]): DataItem[][] {
  const groups: Map<string, DataItem[]> = new Map();

  for (const item of items) {
    // Create a key based on amount and date (within 1 day)
    const dateKey = item.date.toISOString().split('T')[0];
    const amountKey = Math.round(item.amount * 100) / 100; // Round to 2 decimals
    const key = `${dateKey}_${amountKey}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(item);
  }

  return Array.from(groups.values()).filter(group => group.length > 1);
}
