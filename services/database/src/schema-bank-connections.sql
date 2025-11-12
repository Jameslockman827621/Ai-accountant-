-- Bank Connections table for storing Plaid/TrueLayer access tokens
CREATE TABLE IF NOT EXISTS bank_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('plaid', 'truelayer')),
    access_token TEXT NOT NULL,
    item_id VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, item_id)
);

CREATE INDEX idx_bank_connections_tenant_id ON bank_connections(tenant_id);
CREATE INDEX idx_bank_connections_provider ON bank_connections(provider);
CREATE INDEX idx_bank_connections_is_active ON bank_connections(is_active);

ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_bank_connections ON bank_connections
    FOR ALL
    USING (true); -- Will be filtered by application

CREATE TRIGGER update_bank_connections_updated_at BEFORE UPDATE ON bank_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
