-- Phase 3 Compliance Brain Schema
-- Rulepack Catalog and Versioning

CREATE TABLE IF NOT EXISTS rulepack_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  jurisdiction VARCHAR(50) NOT NULL,
  filing_type VARCHAR(100) NOT NULL,
  version VARCHAR(50) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, active, deprecated, archived
  description TEXT,
  dependencies JSONB,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by UUID,
  UNIQUE(name, version)
);

CREATE INDEX idx_rulepack_catalog_jurisdiction ON rulepack_catalog(jurisdiction, filing_type);
CREATE INDEX idx_rulepack_catalog_status ON rulepack_catalog(status, effective_from, effective_to);

-- Rulepack Content Storage (Git-backed in production, DB for metadata)
CREATE TABLE IF NOT EXISTS rulepack_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rulepack_id UUID NOT NULL REFERENCES rulepack_catalog(id) ON DELETE CASCADE,
  content_hash VARCHAR(64) NOT NULL,
  content_text TEXT NOT NULL,
  compiled_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(rulepack_id, content_hash)
);

-- Filing Ledger
CREATE TABLE IF NOT EXISTS filing_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filing_type VARCHAR(100) NOT NULL,
  jurisdiction VARCHAR(50) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, pending_approval, approved, submitted, acknowledged, rejected, amended
  rulepack_version VARCHAR(50),
  rulepack_id UUID REFERENCES rulepack_catalog(id),
  
  -- Filing Data
  filing_data JSONB NOT NULL,
  calculated_values JSONB,
  adjustments JSONB,
  source_transactions JSONB,
  
  -- Submission
  submitted_at TIMESTAMP,
  submitted_by UUID,
  submission_reference VARCHAR(255),
  acknowledgement_reference VARCHAR(255),
  acknowledgement_data JSONB,
  
  -- Approval
  approval_workflow_id UUID,
  approved_at TIMESTAMP,
  approved_by UUID,
  
  -- Audit
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by UUID,
  audit_trail JSONB,
  
  UNIQUE(tenant_id, filing_type, period_start, period_end)
);

CREATE INDEX idx_filing_ledger_tenant_status ON filing_ledger(tenant_id, status);
CREATE INDEX idx_filing_ledger_period ON filing_ledger(period_start, period_end);
CREATE INDEX idx_filing_ledger_jurisdiction ON filing_ledger(jurisdiction, filing_type);

-- Filing Attachments (workpapers, calculations, approvals)
CREATE TABLE IF NOT EXISTS filing_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES filing_ledger(id) ON DELETE CASCADE,
  attachment_type VARCHAR(50) NOT NULL, -- workpaper, calculation, approval, receipt
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500),
  s3_key VARCHAR(500),
  file_size BIGINT,
  mime_type VARCHAR(100),
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  uploaded_by UUID
);

CREATE INDEX idx_filing_attachments_filing ON filing_attachments(filing_id);

-- Compliance Calendar (Obligations)
CREATE TABLE IF NOT EXISTS compliance_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  obligation_type VARCHAR(100) NOT NULL, -- filing, payment, deadline
  jurisdiction VARCHAR(50) NOT NULL,
  filing_type VARCHAR(100),
  due_date DATE NOT NULL,
  period_start DATE,
  period_end DATE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, in_progress, completed, missed, waived
  filing_id UUID REFERENCES filing_ledger(id),
  rulepack_id UUID REFERENCES rulepack_catalog(id),
  
  -- Readiness
  readiness_score INTEGER, -- 0-100
  readiness_details JSONB,
  data_completeness INTEGER,
  reconciliation_status VARCHAR(50),
  connector_health JSONB,
  
  -- Notifications
  notified_at TIMESTAMP,
  reminder_sent BOOLEAN DEFAULT false,
  escalated BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX idx_compliance_calendar_tenant_due ON compliance_calendar(tenant_id, due_date, status);
CREATE INDEX idx_compliance_calendar_jurisdiction ON compliance_calendar(jurisdiction, filing_type);

-- Approval Workflows
CREATE TABLE IF NOT EXISTS approval_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filing_id UUID REFERENCES filing_ledger(id),
  workflow_type VARCHAR(50) NOT NULL, -- filing, payment, amendment
  policy_type VARCHAR(50) NOT NULL, -- auto, accountant_review, client_signoff, multi_level
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, in_progress, approved, rejected, expired
  
  -- Steps
  steps JSONB NOT NULL, -- Array of {step_number, approver_role, approver_id, status, required}
  current_step INTEGER DEFAULT 1,
  
  -- Timing
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  expires_at TIMESTAMP,
  
  -- Digital Signatures
  signatures JSONB, -- Array of {step, signer_id, signature_hash, signed_at, ip_address}
  
  metadata JSONB
);

CREATE INDEX idx_approval_workflows_tenant_status ON approval_workflows(tenant_id, status);
CREATE INDEX idx_approval_workflows_filing ON approval_workflows(filing_id);

-- Approval History (Immutable Audit Trail)
CREATE TABLE IF NOT EXISTS approval_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  action VARCHAR(50) NOT NULL, -- approve, reject, request_changes, delegate
  approver_id UUID NOT NULL,
  approver_role VARCHAR(50),
  comments TEXT,
  signature_hash VARCHAR(64),
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  immutable_hash VARCHAR(64) -- For tamper detection
);

CREATE INDEX idx_approval_history_workflow ON approval_history(workflow_id, step_number);

-- Filing Explanations (Explainability)
CREATE TABLE IF NOT EXISTS filing_explanations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES filing_ledger(id) ON DELETE CASCADE,
  section VARCHAR(100) NOT NULL,
  field_name VARCHAR(100),
  value NUMERIC,
  calculation_steps JSONB, -- Array of calculation steps
  rule_applied JSONB, -- Rulepack rule that was applied
  source_transactions JSONB, -- Transaction IDs that contributed
  adjustments JSONB, -- Any adjustments made
  ai_commentary TEXT, -- AI-generated explanation
  confidence_score NUMERIC,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_filing_explanations_filing ON filing_explanations(filing_id, section);

-- Compliance Evidence Store Metadata (actual files in S3)
CREATE TABLE IF NOT EXISTS compliance_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  filing_id UUID REFERENCES filing_ledger(id),
  evidence_type VARCHAR(50) NOT NULL, -- workpaper, calculation, approval, receipt, audit_trail
  file_name VARCHAR(255) NOT NULL,
  s3_key VARCHAR(500) NOT NULL,
  file_size BIGINT,
  mime_type VARCHAR(100),
  encrypted BOOLEAN DEFAULT true,
  retention_until DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_compliance_evidence_tenant ON compliance_evidence(tenant_id, filing_id);
CREATE INDEX idx_compliance_evidence_type ON compliance_evidence(evidence_type, retention_until);

-- Rulepack Test Results (Regression Testing)
CREATE TABLE IF NOT EXISTS rulepack_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rulepack_id UUID NOT NULL REFERENCES rulepack_catalog(id) ON DELETE CASCADE,
  test_case_id VARCHAR(255),
  test_name VARCHAR(255) NOT NULL,
  test_type VARCHAR(50) NOT NULL, -- regression, fuzzing, scenario
  input_data JSONB NOT NULL,
  expected_output JSONB NOT NULL,
  actual_output JSONB,
  passed BOOLEAN,
  error_message TEXT,
  execution_time_ms INTEGER,
  run_at TIMESTAMP NOT NULL DEFAULT NOW(),
  run_by VARCHAR(255) -- CI pipeline, user, etc.
);

CREATE INDEX idx_rulepack_test_results_rulepack ON rulepack_test_results(rulepack_id, passed, run_at);

-- Updated at triggers
CREATE TRIGGER update_rulepack_catalog_updated_at
  BEFORE UPDATE ON rulepack_catalog
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_filing_ledger_updated_at
  BEFORE UPDATE ON filing_ledger
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_compliance_calendar_updated_at
  BEFORE UPDATE ON compliance_calendar
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_approval_workflows_updated_at
  BEFORE UPDATE ON approval_workflows
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
