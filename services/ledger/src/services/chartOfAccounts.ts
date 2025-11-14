import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId } from '@ai-accountant/shared-types';
import { randomUUID } from 'crypto';

const logger = createLogger('ledger-service');

export interface ChartOfAccountsEntry {
  accountCode: string;
  accountName: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentCode?: string;
  isActive: boolean;
}

// Default UK Chart of Accounts
const DEFAULT_UK_CHART: ChartOfAccountsEntry[] = [
  // Assets (1xxx)
  { accountCode: '1000', accountName: 'Fixed Assets', accountType: 'asset', isActive: true },
  { accountCode: '1100', accountName: 'Cash', accountType: 'asset', isActive: true },
  { accountCode: '1200', accountName: 'Accounts Receivable', accountType: 'asset', isActive: true },
  { accountCode: '1300', accountName: 'Inventory', accountType: 'asset', isActive: true },
  { accountCode: '1400', accountName: 'Prepaid Expenses', accountType: 'asset', isActive: true },
  
  // Liabilities (2xxx)
  { accountCode: '2000', accountName: 'Accounts Payable', accountType: 'liability', isActive: true },
  { accountCode: '2100', accountName: 'Accrued Expenses', accountType: 'liability', isActive: true },
  { accountCode: '2200', accountName: 'VAT Input', accountType: 'liability', isActive: true },
  { accountCode: '2300', accountName: 'VAT Output', accountType: 'liability', isActive: true },
  { accountCode: '2400', accountName: 'Tax Payable', accountType: 'liability', isActive: true },
  
  // Equity (3xxx)
  { accountCode: '3000', accountName: 'Share Capital', accountType: 'equity', isActive: true },
  { accountCode: '3100', accountName: 'Retained Earnings', accountType: 'equity', isActive: true },
  
  // Revenue (4xxx)
  { accountCode: '4000', accountName: 'Revenue', accountType: 'revenue', isActive: true },
  { accountCode: '4100', accountName: 'Other Income', accountType: 'revenue', isActive: true },
  
  // Expenses (5xxx, 6xxx)
  { accountCode: '5000', accountName: 'Cost of Goods Sold', accountType: 'expense', isActive: true },
  { accountCode: '5100', accountName: 'Operating Expenses', accountType: 'expense', isActive: true },
  { accountCode: '5200', accountName: 'Salaries and Wages', accountType: 'expense', isActive: true },
  { accountCode: '5300', accountName: 'Rent', accountType: 'expense', isActive: true },
  { accountCode: '5400', accountName: 'Utilities', accountType: 'expense', isActive: true },
  { accountCode: '5500', accountName: 'Marketing', accountType: 'expense', isActive: true },
  { accountCode: '6000', accountName: 'Depreciation', accountType: 'expense', isActive: true },
  { accountCode: '6100', accountName: 'Interest Expense', accountType: 'expense', isActive: true },
  { accountCode: '6200', accountName: 'Tax Expense', accountType: 'expense', isActive: true },
];

export async function initializeChartOfAccounts(tenantId: TenantId): Promise<void> {
  logger.info('Initializing chart of accounts', { tenantId });

  // Check if already initialized
  const existing = await db.query<{ count: string | number }>(
    'SELECT COUNT(*) as count FROM chart_of_accounts WHERE tenant_id = $1',
    [tenantId]
  );

  const count = typeof existing.rows[0]?.count === 'number'
    ? existing.rows[0].count
    : parseInt(String(existing.rows[0]?.count || '0'), 10);

  if (count > 0) {
    logger.info('Chart of accounts already initialized', { tenantId });
    return;
  }

  // Insert default accounts
  for (const account of DEFAULT_UK_CHART) {
    await db.query(
      `INSERT INTO chart_of_accounts (
        id, tenant_id, account_code, account_name, account_type, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (tenant_id, account_code) DO NOTHING`,
      [
        randomUUID(),
        tenantId,
        account.accountCode,
        account.accountName,
        account.accountType,
        account.isActive,
      ]
    );
  }

  logger.info('Chart of accounts initialized', { tenantId, accountCount: DEFAULT_UK_CHART.length });
}

export async function getChartOfAccounts(tenantId: TenantId): Promise<ChartOfAccountsEntry[]> {
  const result = await db.query<{
    account_code: string;
    account_name: string;
    account_type: string;
    parent_code: string | null;
    is_active: boolean;
  }>(
    'SELECT account_code, account_name, account_type, parent_code, is_active FROM chart_of_accounts WHERE tenant_id = $1 ORDER BY account_code',
    [tenantId]
  );

  return result.rows.map(row => ({
    accountCode: row.account_code,
    accountName: row.account_name,
    accountType: row.account_type as ChartOfAccountsEntry['accountType'],
    parentCode: row.parent_code || undefined,
    isActive: row.is_active,
  }));
}

export async function validateAccount(tenantId: TenantId, accountCode: string): Promise<boolean> {
  const result = await db.query<{ count: string | number }>(
    'SELECT COUNT(*) as count FROM chart_of_accounts WHERE tenant_id = $1 AND account_code = $2 AND is_active = true',
    [tenantId, accountCode]
  );

  const count = typeof result.rows[0]?.count === 'number'
    ? result.rows[0].count
    : parseInt(String(result.rows[0]?.count || '0'), 10);

  return count > 0;
}

export async function updateChartOfAccounts(
  tenantId: TenantId,
  accounts: ChartOfAccountsEntry[]
): Promise<void> {
  await db.transaction(async (client) => {
    for (const account of accounts) {
      await client.query(
        `INSERT INTO chart_of_accounts (
          id, tenant_id, account_code, account_name, account_type, parent_code, is_active, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
        ON CONFLICT (tenant_id, account_code) DO UPDATE
        SET account_name = $4, account_type = $5, parent_code = $6, is_active = $7, updated_at = NOW()`,
        [
          randomUUID(),
          tenantId,
          account.accountCode,
          account.accountName,
          account.accountType,
          account.parentCode || null,
          account.isActive,
        ]
      );
    }
  });

  logger.info('Chart of accounts updated', { tenantId, accountCount: accounts.length });
}
