import { db } from './index';
import bcrypt from 'bcrypt';

async function seed(): Promise<void> {
  try {
    console.log('Seeding database...');

    // Create a default tenant
    const tenantResult = await db.query(
      `INSERT INTO tenants (id, name, country, subscription_tier)
       VALUES (uuid_generate_v4(), 'Demo Company', 'GB', 'freelancer')
       RETURNING id`
    );
    const tenantId = tenantResult.rows[0]?.id;

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
