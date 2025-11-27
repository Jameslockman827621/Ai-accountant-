import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, DocumentId } from '@ai-accountant/shared-types';

const logger = createLogger('document-ingest-service');

export interface DuplicateCandidate {
  documentId: DocumentId;
  fileName: string;
  similarity: number;
  reason: string;
}

export async function detectDuplicates(
  tenantId: TenantId,
  documentId: DocumentId
): Promise<DuplicateCandidate[]> {
  // Get the document
  const docResult = await db.query<{
    file_name: string;
    extracted_data: unknown;
    created_at: Date;
  }>(
    'SELECT file_name, extracted_data, created_at FROM documents WHERE id = $1 AND tenant_id = $2',
    [documentId, tenantId]
  );

  if (docResult.rows.length === 0) {
    return [];
  }

  const doc = docResult.rows[0];
  const extractedData = (doc as unknown as { extracted_data?: Record<string, unknown> | null }).extracted_data || null;

  if (!extractedData) {
    return [];
  }

  const candidates: DuplicateCandidate[] = [];

  // Check for duplicates by file name
  const nameMatches = await db.query<{
    id: string;
    file_name: string;
    created_at: Date;
  }>(
    `SELECT id, file_name, created_at
     FROM documents
     WHERE tenant_id = $1
       AND id != $2
       AND file_name = $3`,
    [tenantId, documentId, doc.file_name]
  );

  for (const match of nameMatches.rows) {
    candidates.push({
      documentId: match.id,
      fileName: match.file_name,
      similarity: 1.0,
      reason: 'Exact file name match',
    });
  }

  // Check for duplicates by extracted data (amount + date + vendor)
  if (extractedData.total && extractedData.date && extractedData.vendor) {
    const dataMatches = await db.query<{
      id: string;
      file_name: string;
      extracted_data: unknown;
    }>(
      `SELECT id, file_name, extracted_data
       FROM documents
       WHERE tenant_id = $1
         AND id != $2
         AND extracted_data->>'total' = $3
         AND extracted_data->>'date' = $4
         AND extracted_data->>'vendor' = $5`,
      [
        tenantId,
        documentId,
        String(extractedData.total),
        String(extractedData.date),
        String(extractedData.vendor),
      ]
    );

    for (const match of dataMatches.rows) {
      // Check if not already in candidates
      if (!candidates.find(c => c.documentId === match.id)) {
        candidates.push({
          documentId: match.id,
          fileName: match.file_name,
          similarity: 0.9,
          reason: 'Matching amount, date, and vendor',
        });
      }
    }
  }

  // Check for duplicates by invoice number
  if (extractedData.invoiceNumber) {
    const invoiceMatches = await db.query<{
      id: string;
      file_name: string;
    }>(
      `SELECT id, file_name
       FROM documents
       WHERE tenant_id = $1
         AND id != $2
         AND extracted_data->>'invoiceNumber' = $3`,
      [tenantId, documentId, String(extractedData.invoiceNumber)]
    );

    for (const match of invoiceMatches.rows) {
      if (!candidates.find(c => c.documentId === match.id)) {
        candidates.push({
          documentId: match.id,
          fileName: match.file_name,
          similarity: 0.95,
          reason: 'Matching invoice number',
        });
      }
    }
  }

  if (extractedData.invoiceNumber) {
    const ledgerMatches = await db.query<{
      id: string;
      transaction_date: Date;
      amount: string | number;
    }>(
      `SELECT id, transaction_date, amount
       FROM ledger_entries
       WHERE tenant_id = $1
         AND metadata->>'invoiceNumber' = $2`,
      [tenantId, String(extractedData.invoiceNumber)]
    );

    for (const match of ledgerMatches.rows) {
      candidates.push({
        documentId: match.id,
        fileName: 'ledger-entry',
        similarity: 0.65,
        reason: 'Existing ledger entry with same invoice number',
      });
    }
  }

  // Sort by similarity descending
  return candidates.sort((a, b) => b.similarity - a.similarity);
}
