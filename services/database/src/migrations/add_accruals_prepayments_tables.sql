-- Migration: Add accruals and prepayments tables

CREATE TABLE IF NOT EXISTS accruals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    account_code VARCHAR(20) NOT NULL,
    amount DECIMAL(18, 2) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'posted', 'reversed')),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prepayments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    account_code VARCHAR(20) NOT NULL,
    amount DECIMAL(18, 2) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'posted', 'amortized')),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accruals_tenant_id ON accruals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_accruals_status ON accruals(status);
CREATE INDEX IF NOT EXISTS idx_prepayments_tenant_id ON prepayments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prepayments_status ON prepayments(status);
