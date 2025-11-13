-- Migration: Add validation rules table for custom business rules

CREATE TABLE IF NOT EXISTS validation_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN ('amount', 'date', 'category', 'duplicate', 'custom')),
    condition JSONB NOT NULL,
    action VARCHAR(20) NOT NULL CHECK (action IN ('warn', 'error', 'block')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_validation_rules_tenant_id ON validation_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_validation_rules_type ON validation_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_validation_rules_active ON validation_rules(is_active);
