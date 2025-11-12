-- Approval workflows table
CREATE TABLE IF NOT EXISTS approval_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('filing', 'ledger_entry', 'document')),
  entity_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  approvers JSONB NOT NULL,
  required_approvals INTEGER NOT NULL DEFAULT 1,
  current_approvals INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_workflows_tenant_id ON approval_workflows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_status ON approval_workflows(status);
CREATE INDEX IF NOT EXISTS idx_approval_workflows_entity ON approval_workflows(entity_type, entity_id);

-- Add RLS policy
ALTER TABLE approval_workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_workflows_tenant_isolation ON approval_workflows
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
