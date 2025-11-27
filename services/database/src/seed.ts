import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import { db } from './index';

const SAMPLE_TENANT_ID = '00000000-0000-0000-0000-00000000DEMO';

async function seedSampleData(tenantId: string, createdBy: string): Promise<void> {
  const sampleDocuments = [
    {
      vendor: 'AI Supplies Ltd',
      amount: 180.25,
      tax: 36.05,
      date: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000),
      description: 'Laptops and peripherals',
    },
    {
      vendor: 'Workspace Rentals',
      amount: 950,
      tax: 190,
      date: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
      description: 'Office rent',
    },
  ];

  for (const doc of sampleDocuments) {
    const docId = randomUUID();
    await db.query(
      `INSERT INTO documents (
        id, tenant_id, uploaded_by, file_name, file_type, file_size,
        storage_key, document_type, status, extracted_data, confidence_score,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO NOTHING`,
      [
        docId,
        tenantId,
        createdBy,
        `sample_${doc.vendor.replace(/\s+/g, '_').toLowerCase()}.pdf`,
        'application/pdf',
        10240,
        `sample/${docId}`,
        'invoice',
        'extracted',
        JSON.stringify({
          vendor: doc.vendor,
          total: doc.amount,
          tax: doc.tax,
          date: doc.date.toISOString(),
          description: doc.description,
        }),
        0.9,
        doc.date,
      ]
    );
  }

  const ledgerEntries = [
    {
      entry_type: 'debit',
      account_code: '5100',
      account_name: 'Software & Subscriptions',
      amount: 299.99,
      currency: 'GBP',
      description: 'Annual SaaS subscription',
      transaction_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
    {
      entry_type: 'credit',
      account_code: '4000',
      account_name: 'Revenue',
      amount: 299.99,
      currency: 'GBP',
      description: 'Annual SaaS subscription',
      transaction_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  ];

  for (const entry of ledgerEntries) {
    await db.query(
      `INSERT INTO ledger_entries (
        id, tenant_id, entry_type, account_code, account_name, amount,
        currency, description, transaction_date, created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO NOTHING`,
      [
        randomUUID(),
        tenantId,
        entry.entry_type,
        entry.account_code,
        entry.account_name,
        entry.amount,
        entry.currency,
        entry.description,
        entry.transaction_date,
        createdBy,
        entry.transaction_date,
      ]
    );
  }

  const bankTransactions = [
    {
      account_id: 'demo_account',
      transaction_id: 'demo_tx_1',
      amount: 1500,
      description: 'Client payment',
      date: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000),
    },
    {
      account_id: 'demo_account',
      transaction_id: 'demo_tx_2',
      amount: -425.5,
      description: 'Cloud hosting',
      date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    },
  ];

  for (const tx of bankTransactions) {
    await db.query(
      `INSERT INTO bank_transactions (
        id, tenant_id, account_id, transaction_id, date, amount,
        currency, description, reconciled, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tenant_id, account_id, transaction_id) DO NOTHING`,
      [
        randomUUID(),
        tenantId,
        tx.account_id,
        tx.transaction_id,
        tx.date,
        tx.amount,
        'GBP',
        tx.description,
        false,
        tx.date,
      ]
    );
  }
}

async function seed(): Promise<void> {
  try {
    console.log('Seeding database...');

    // Create a default tenant
    const tenantResult = await db.query(
      `INSERT INTO tenants (id, name, country, subscription_tier)
       VALUES (uuid_generate_v4(), 'Demo Company', 'GB', 'freelancer')
       RETURNING id`
    );
    const tenantId = (tenantResult.rows[0] as { id: string })?.id;

    if (!tenantId) {
      throw new Error('Failed to create tenant');
    }

    // Create a default admin user
    const passwordHash = await bcrypt.hash('admin123', 10);
    await db.query(
      `INSERT INTO users (id, tenant_id, email, name, password_hash, role)
       VALUES (uuid_generate_v4(), $1, 'admin@example.com', 'Admin User', $2, 'super_admin')
       ON CONFLICT DO NOTHING`,
      [tenantId, passwordHash]
    );

    // Create default chart of accounts
    const defaultAccounts = [
      { code: '1000', name: 'Cash', type: 'asset', parentCode: null },
      { code: '2000', name: 'Accounts Receivable', type: 'asset', parentCode: null },
      { code: '3000', name: 'Inventory', type: 'asset', parentCode: null },
      { code: '4000', name: 'Accounts Payable', type: 'liability', parentCode: null },
      { code: '5000', name: 'Sales Revenue', type: 'revenue', parentCode: null },
      { code: '6000', name: 'Cost of Goods Sold', type: 'expense', parentCode: null },
      { code: '7000', name: 'Operating Expenses', type: 'expense', parentCode: null },
      { code: '8000', name: 'VAT Payable', type: 'liability', parentCode: null },
      { code: '9000', name: 'VAT Recoverable', type: 'asset', parentCode: null },
    ];

    await db.query(
      `INSERT INTO chart_of_accounts (tenant_id, accounts)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET accounts = $2`,
      [tenantId, JSON.stringify(defaultAccounts)]
    );

    // Seed demo sample tenant with realistic data for the onboarding try-out path
    const samplePassword = await bcrypt.hash('demo123', 10);
    await db.query(
      `INSERT INTO tenants (id, name, country, subscription_tier)
       VALUES ($1, 'Sample Demo Company', 'GB', 'growth')
       ON CONFLICT (id) DO NOTHING`,
      [SAMPLE_TENANT_ID]
    );

    const sampleUserId = randomUUID();
    await db.query(
      `INSERT INTO users (id, tenant_id, email, name, password_hash, role)
       VALUES ($1, $2, 'demo.user@example.com', 'Demo User', $3, 'admin')
       ON CONFLICT (id) DO NOTHING`,
      [sampleUserId, SAMPLE_TENANT_ID, samplePassword]
    );

    await db.query(
      `INSERT INTO chart_of_accounts (tenant_id, accounts)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET accounts = $2`,
      [SAMPLE_TENANT_ID, JSON.stringify(defaultAccounts)]
    );

    await seedSampleData(SAMPLE_TENANT_ID, sampleUserId);

    console.log('Seeding completed successfully');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  seed();
}
