-- Migration: Add multi-level approvals table

CREATE TABLE IF NOT EXISTS multi_level_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('document', 'filing', 'ledger_entry')),
    entity_id UUID NOT NULL,
    levels JSONB NOT NULL,
    current_level INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    approvals JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_multi_level_approvals_tenant_id ON multi_level_approvals(tenant_id);
CREATE INDEX IF NOT EXISTS idx_multi_level_approvals_entity ON multi_level_approvals(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_multi_level_approvals_status ON multi_level_approvals(status);
