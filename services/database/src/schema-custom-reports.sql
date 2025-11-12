-- Custom reports table
CREATE TABLE IF NOT EXISTS custom_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  config JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_reports_tenant_id ON custom_reports(tenant_id);

-- Add RLS policy
ALTER TABLE custom_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_reports_tenant_isolation ON custom_reports
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
