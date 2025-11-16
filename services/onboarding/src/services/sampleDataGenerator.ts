import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';
import { initializeChartOfAccounts } from '@ai-accountant/ledger-service/services/chartOfAccounts';

const logger = createLogger('onboarding-service');

/**
 * Generate sample data for demo/onboarding purposes
 * Creates realistic sample transactions, documents, and ledger entries
 */
export async function generateSampleData(
  tenantId: TenantId,
  createdBy: UserId
): Promise<{
  documentsCreated: number;
  ledgerEntriesCreated: number;
  bankTransactionsCreated: number;
}> {
  logger.info('Generating sample data', { tenantId });

  // Initialize chart of accounts if not exists
  await initializeChartOfAccounts(tenantId);

  const documentsCreated = await generateSampleDocuments(tenantId, createdBy);
  const ledgerEntriesCreated = await generateSampleLedgerEntries(tenantId, createdBy);
  const bankTransactionsCreated = await generateSampleBankTransactions(tenantId);

  logger.info('Sample data generated', {
    tenantId,
    documentsCreated,
    ledgerEntriesCreated,
    bankTransactionsCreated,
  });

  return {
    documentsCreated,
    ledgerEntriesCreated,
    bankTransactionsCreated,
  };
}

async function generateSampleDocuments(
  tenantId: TenantId,
  createdBy: UserId
): Promise<number> {
  const sampleInvoices = [
    {
      vendor: 'Office Supplies Co',
      amount: 125.50,
      tax: 25.10,
      date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      description: 'Office supplies and stationery',
    },
    {
      vendor: 'Cloud Hosting Ltd',
      amount: 89.99,
      tax: 17.99,
      date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      description: 'Monthly hosting subscription',
    },
    {
      vendor: 'Marketing Agency',
      amount: 1500.00,
      tax: 300.00,
      date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      description: 'Marketing campaign services',
    },
    {
      vendor: 'Software License Inc',
      amount: 299.99,
      tax: 59.99,
      date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      description: 'Annual software license',
    },
    {
      vendor: 'Consulting Services',
      amount: 2500.00,
      tax: 500.00,
      date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      description: 'Business consulting services',
    },
  ];

  const sampleReceipts = [
    {
      vendor: 'Coffee Shop',
      amount: 12.50,
      tax: 2.50,
      date: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
      description: 'Client meeting expenses',
    },
    {
      vendor: 'Travel Expenses',
      amount: 45.00,
      tax: 9.00,
      date: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000),
      description: 'Train ticket',
    },
    {
      vendor: 'Restaurant',
      amount: 78.50,
      tax: 15.70,
      date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
      description: 'Business lunch',
    },
  ];

  const allDocuments = [...sampleInvoices, ...sampleReceipts];

  for (const doc of allDocuments) {
    const docId = randomUUID();
    await db.query(
      `INSERT INTO documents (
        id, tenant_id, uploaded_by, file_name, file_type, file_size,
        storage_key, document_type, status, extracted_data, confidence_score,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        docId,
        tenantId,
        createdBy,
        `sample_${doc.vendor.replace(/\s+/g, '_').toLowerCase()}.pdf`,
        'application/pdf',
        10240,
        `sample/${docId}`,
        doc.amount > 100 ? 'invoice' : 'receipt',
        'extracted',
        JSON.stringify({
          vendor: doc.vendor,
          total: doc.amount,
          tax: doc.tax,
          date: doc.date.toISOString(),
          description: doc.description,
        }),
        0.95, // High confidence for sample data
        doc.date,
      ]
    );
  }

  return allDocuments.length;
}

async function generateSampleLedgerEntries(
  tenantId: TenantId,
  createdBy: UserId
): Promise<number> {
  const sampleTransactions = [
    {
      description: 'Office supplies expense',
      date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      debit: { accountCode: '5000', accountName: 'Office Expenses', amount: 125.50 },
      credit: { accountCode: '2000', accountName: 'Accounts Payable', amount: 125.50 },
    },
    {
      description: 'Cloud hosting subscription',
      date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      debit: { accountCode: '5100', accountName: 'Software & Subscriptions', amount: 89.99 },
      credit: { accountCode: '2000', accountName: 'Accounts Payable', amount: 89.99 },
    },
    {
      description: 'Marketing services',
      date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      debit: { accountCode: '5200', accountName: 'Marketing Expenses', amount: 1500.00 },
      credit: { accountCode: '2000', accountName: 'Accounts Payable', amount: 1500.00 },
    },
    {
      description: 'Client payment received',
      date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      debit: { accountCode: '1000', accountName: 'Bank Account', amount: 5000.00 },
      credit: { accountCode: '4000', accountName: 'Revenue', amount: 5000.00 },
    },
  ];

  for (const tx of sampleTransactions) {
    const entryId1 = randomUUID();
    const entryId2 = randomUUID();

    // Debit entry
    await db.query(
      `INSERT INTO ledger_entries (
        id, tenant_id, entry_type, account_code, account_name, amount,
        currency, description, transaction_date, created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        entryId1,
        tenantId,
        'debit',
        tx.debit.accountCode,
        tx.debit.accountName,
        tx.debit.amount,
        'GBP',
        tx.description,
        tx.date,
        createdBy,
        tx.date,
      ]
    );

    // Credit entry
    await db.query(
      `INSERT INTO ledger_entries (
        id, tenant_id, entry_type, account_code, account_name, amount,
        currency, description, transaction_date, created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        entryId2,
        tenantId,
        'credit',
        tx.credit.accountCode,
        tx.credit.accountName,
        tx.credit.amount,
        'GBP',
        tx.description,
        tx.date,
        createdBy,
        tx.date,
      ]
    );
  }

  return sampleTransactions.length * 2; // Each transaction has 2 entries
}

async function generateSampleBankTransactions(tenantId: TenantId): Promise<number> {
  const sampleTransactions = [
    {
      accountId: 'sample_bank_account',
      transactionId: 'sample_tx_1',
      date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      amount: 5000.00,
      description: 'Payment received from client',
    },
    {
      accountId: 'sample_bank_account',
      transactionId: 'sample_tx_2',
      date: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      amount: -125.50,
      description: 'Office supplies payment',
    },
    {
      accountId: 'sample_bank_account',
      transactionId: 'sample_tx_3',
      date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      amount: -89.99,
      description: 'Cloud hosting payment',
    },
  ];

  for (const tx of sampleTransactions) {
    await db.query(
      `INSERT INTO bank_transactions (
        id, tenant_id, account_id, transaction_id, date, amount,
        currency, description, reconciled, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tenant_id, account_id, transaction_id) DO NOTHING`,
      [
        randomUUID(),
        tenantId,
        tx.accountId,
        tx.transactionId,
        tx.date,
        tx.amount,
        'GBP',
        tx.description,
        false,
        tx.date,
      ]
    );
  }

  return sampleTransactions.length;
}
