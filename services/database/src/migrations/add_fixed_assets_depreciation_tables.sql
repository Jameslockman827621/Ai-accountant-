-- Migration: Add fixed assets and depreciation tables

CREATE TABLE IF NOT EXISTS fixed_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    account_code VARCHAR(20) NOT NULL,
    purchase_date DATE NOT NULL,
    purchase_cost DECIMAL(18, 2) NOT NULL,
    residual_value DECIMAL(18, 2) NOT NULL DEFAULT 0,
    useful_life INTEGER NOT NULL, -- in years
    depreciation_method VARCHAR(50) NOT NULL CHECK (depreciation_method IN ('straight_line', 'reducing_balance', 'units_of_production')),
    depreciation_rate DECIMAL(5, 4), -- for reducing balance
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS depreciation_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
    period DATE NOT NULL,
    depreciation_amount DECIMAL(18, 2) NOT NULL,
    accumulated_depreciation DECIMAL(18, 2) NOT NULL,
    net_book_value DECIMAL(18, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, asset_id, period)
);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_tenant_id ON fixed_assets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_asset_id ON depreciation_entries(asset_id);
CREATE INDEX IF NOT EXISTS idx_depreciation_entries_period ON depreciation_entries(period);
