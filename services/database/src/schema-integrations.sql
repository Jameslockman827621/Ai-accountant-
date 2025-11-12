-- Integration tokens and OAuth states
CREATE TABLE IF NOT EXISTS oauth_states (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  state VARCHAR(255) NOT NULL,
  redirect_uri TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, provider)
);

CREATE TABLE IF NOT EXISTS integration_tokens (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_created_at ON oauth_states(created_at);
CREATE INDEX IF NOT EXISTS idx_integration_tokens_expires_at ON integration_tokens(expires_at);

-- Add RLS policies
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY oauth_states_tenant_isolation ON oauth_states
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

CREATE POLICY integration_tokens_tenant_isolation ON integration_tokens
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
