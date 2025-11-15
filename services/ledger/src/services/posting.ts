import { db } from '@ai-accountant/database';
import { createLogger, ValidationError } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { createLedgerEntry, CreateLedgerEntryInput } from './ledger';
import { enforceConfidenceThreshold } from '@ai-accountant/validation-service/services/confidenceThreshold';
import {
  validateDocumentForPosting,
} from '@ai-accountant/validation-service/services/documentPostingValidator';

const logger = createLogger('ledger-service');

export interface DoubleEntryTransaction {
  tenantId: TenantId;
  documentId?: string;
  description: string;
  transactionDate: Date;
  entries: Array<{
    entryType: 'debit' | 'credit';
    accountCode: string;
    accountName: string;
    amount: number;
    taxAmount?: number;
    taxRate?: number;
  }>;
  createdBy: UserId;
  metadata?: Record<string, unknown>;
}

export async function postDoubleEntry(transaction: DoubleEntryTransaction): Promise<{ transactionId: string; entryIds: string[] }> {
  // Validate double-entry: debits must equal credits
  const totalDebits = transaction.entries
    .filter(e => e.entryType === 'debit')
    .reduce((sum, e) => sum + e.amount, 0);
  
  const totalCredits = transaction.entries
    .filter(e => e.entryType === 'credit')
    .reduce((sum, e) => sum + e.amount, 0);

  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new ValidationError(`Double-entry validation failed: debits (${totalDebits}) must equal credits (${totalCredits})`);
  }

  const transactionId = randomUUID();
  const entryIds: string[] = [];

  // Create all entries in a transaction
  await db.transaction(async (client) => {
    for (const entry of transaction.entries) {
      const entryInput: CreateLedgerEntryInput = {
        tenantId: transaction.tenantId,
        entryType: entry.entryType,
        accountCode: entry.accountCode,
        accountName: entry.accountName,
        amount: entry.amount,
        description: transaction.description,
        transactionDate: transaction.transactionDate,
        taxAmount: entry.taxAmount,
        taxRate: entry.taxRate,
      };

      if (transaction.documentId) {
        entryInput.documentId = transaction.documentId;
      }

      const entryId = await createLedgerEntry(entryInput);
      entryIds.push(entryId);
    }

    // Store transaction metadata
    await client.query(
      `INSERT INTO transactions (id, tenant_id, document_id, description, transaction_date, created_by, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        transactionId,
        transaction.tenantId,
        transaction.documentId || null,
        transaction.description,
        transaction.transactionDate,
        transaction.createdBy,
        JSON.stringify(transaction.metadata || {}),
      ]
    );
  });

  logger.info('Double-entry transaction posted', {
    transactionId,
    tenantId: transaction.tenantId,
    entryCount: entryIds.length,
  });

  return { transactionId, entryIds };
}

export async function postDocumentToLedger(
  tenantId: TenantId,
  documentId: string,
  createdBy: UserId
): Promise<{ transactionId: string; entryIds: string[] }> {
  // Get document
  const docResult = await db.query<{
    id: string;
    document_type: string;
    extracted_data: Record<string, unknown> | null;
    status: string;
  }>(
    'SELECT id, document_type, extracted_data, status FROM documents WHERE id = $1 AND tenant_id = $2',
    [documentId, tenantId]
  );

  if (docResult.rows.length === 0) {
    throw new ValidationError('Document not found');
  }

  const document = docResult.rows[0];
  if (!document) {
    throw new ValidationError('Document not found');
  }

  if (document.status === 'posted') {
    throw new ValidationError('Document already posted to ledger');
  }

  const requiresManualReview = await enforceConfidenceThreshold(documentId, tenantId);
  if (requiresManualReview) {
    throw new ValidationError('Document requires manual review before posting');
  }

  const validationResult = await validateDocumentForPosting(tenantId, documentId);
  if (!validationResult.isValid || !validationResult.normalizedData) {
    throw new ValidationError(
      validationResult.errors.join('; ') || 'Document failed validation checks'
    );
  }

  if (validationResult.warnings.length > 0) {
    logger.warn('Non-blocking validation warnings detected for document posting', {
      documentId,
      warnings: validationResult.warnings,
    });
  }

  const normalized = validationResult.normalizedData;
  const total = normalized.total;
  const tax = normalized.tax;
  const date = normalized.date;
  const vendor = normalized.vendor;
  const description = normalized.description;

  // Determine account codes based on document type
  let debitAccount = '5000'; // Default expense account
  let debitAccountName = 'Expenses';
  let creditAccount = '2000'; // Default liability account
  let creditAccountName = 'Accounts Payable';

  const docType = normalized.documentType || document.document_type;
  if (docType === 'invoice' && total > 0) {
    // Sales invoice - credit revenue, debit receivables
    creditAccount = '4000';
    creditAccountName = 'Revenue';
    debitAccount = '1200';
    debitAccountName = 'Accounts Receivable';
  } else if (docType === 'receipt' || docType === 'expense') {
    // Expense - debit expense, credit cash/payable
    debitAccount = '5000';
    debitAccountName = 'Expenses';
    creditAccount = '1100';
    creditAccountName = 'Cash';
  }

  const amountExVAT = total - tax;
  const entries: DoubleEntryTransaction['entries'] = [];

  // Debit entry
  entries.push({
    entryType: 'debit',
    accountCode: debitAccount,
    accountName: debitAccountName,
    amount: amountExVAT,
    taxAmount: tax,
    taxRate: normalized.taxRate || (tax > 0 ? tax / total : undefined),
  });

  // Credit entry
  entries.push({
    entryType: 'credit',
    accountCode: creditAccount,
    accountName: creditAccountName,
    amount: amountExVAT,
  });

  // VAT entry if applicable
  if (tax > 0) {
    entries.push({
      entryType: 'debit',
      accountCode: '2200',
      accountName: 'VAT Input',
      amount: tax,
    });
  }

  const result = await postDoubleEntry({
    tenantId,
    documentId,
    description,
    transactionDate: date,
    entries,
    createdBy,
  });

  // Update document status
  await db.query(
    'UPDATE documents SET status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3',
    ['posted', documentId, tenantId]
  );

  logger.info('Document posted to ledger', { documentId, transactionId: result.transactionId, tenantId });

  return result;
}
