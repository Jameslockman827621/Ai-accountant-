-- Migration: Add error_records table

CREATE TABLE IF NOT EXISTS error_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    error_type VARCHAR(50) NOT NULL CHECK (error_type IN ('processing', 'validation', 'network', 'system')),
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('document', 'ledger_entry', 'filing', 'transaction')),
    entity_id UUID NOT NULL,
    error_message TEXT NOT NULL,
    retryable BOOLEAN NOT NULL DEFAULT true,
    retry_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'resolved', 'failed')),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_records_tenant_id ON error_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_error_records_status ON error_records(status);
CREATE INDEX IF NOT EXISTS idx_error_records_entity ON error_records(entity_type, entity_id);
