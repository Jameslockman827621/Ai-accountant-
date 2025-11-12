-- Review tasks table for human-in-loop workflows
CREATE TABLE IF NOT EXISTS review_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('document', 'ledger_entry', 'filing', 'transaction')),
  entity_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs_revision')),
  assigned_to UUID REFERENCES users(id),
  priority VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  comments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_tasks_tenant_id ON review_tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_review_tasks_status ON review_tasks(status);
CREATE INDEX IF NOT EXISTS idx_review_tasks_assigned_to ON review_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_review_tasks_entity ON review_tasks(type, entity_id);

-- Add RLS policy
ALTER TABLE review_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY review_tasks_tenant_isolation ON review_tasks
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- Document annotations table
CREATE TABLE IF NOT EXISTS document_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  annotation_type VARCHAR(20) NOT NULL CHECK (annotation_type IN ('comment', 'highlight', 'flag', 'correction')),
  content TEXT,
  coordinates JSONB, -- For highlighting specific areas
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_annotations_document_id ON document_annotations(document_id);
CREATE INDEX IF NOT EXISTS idx_document_annotations_tenant_id ON document_annotations(tenant_id);

-- Add RLS policy
ALTER TABLE document_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_annotations_tenant_isolation ON document_annotations
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);
