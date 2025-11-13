-- Migration: Add recovery strategies table

CREATE TABLE IF NOT EXISTS recovery_strategies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    error_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    strategy VARCHAR(50) NOT NULL CHECK (strategy IN ('auto_retry', 'manual_intervention', 'skip', 'transform')),
    max_retries INTEGER NOT NULL DEFAULT 3,
    retry_delay INTEGER NOT NULL DEFAULT 1000,
    transform_function TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recovery_strategies_tenant_id ON recovery_strategies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_recovery_strategies_lookup ON recovery_strategies(tenant_id, error_type, entity_type);
