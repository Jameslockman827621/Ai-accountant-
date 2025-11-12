-- Chart of Accounts table
CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_code VARCHAR(20) NOT NULL,
  account_name VARCHAR(255) NOT NULL,
  account_type VARCHAR(50) NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_code VARCHAR(20),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, account_code)
);

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_tenant ON chart_of_accounts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_code ON chart_of_accounts(account_code);
CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_type ON chart_of_accounts(account_type);

COMMENT ON TABLE chart_of_accounts IS 'Chart of accounts for each tenant';
COMMENT ON COLUMN chart_of_accounts.account_type IS 'Account type: asset, liability, equity, revenue, expense';
