-- Bank Connections table for storing Plaid/TrueLayer access tokens
CREATE TABLE IF NOT EXISTS bank_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL CHECK (provider IN ('plaid', 'truelayer')),
    access_token_encrypted JSONB,
    refresh_token_encrypted JSONB,
    webhook_secret_encrypted JSONB,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    last_refreshed_at TIMESTAMP WITH TIME ZONE,
    last_sync TIMESTAMP WITH TIME ZONE,
    last_success TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    item_id TEXT,
    provider_account_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    exception_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, provider, COALESCE(provider_account_id, item_id))
);

CREATE INDEX idx_bank_connections_tenant_id ON bank_connections(tenant_id);
CREATE INDEX idx_bank_connections_provider ON bank_connections(provider);
CREATE INDEX idx_bank_connections_is_active ON bank_connections(is_active);
CREATE INDEX idx_bank_connections_token_expiry ON bank_connections(provider, token_expires_at) WHERE token_expires_at IS NOT NULL;

ALTER TABLE bank_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_bank_connections ON bank_connections
    FOR ALL
    USING (true);

CREATE TRIGGER update_bank_connections_updated_at BEFORE UPDATE ON bank_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
