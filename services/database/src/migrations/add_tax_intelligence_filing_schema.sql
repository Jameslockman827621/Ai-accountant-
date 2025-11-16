-- Migration: Add tables for Tax Intelligence, Filing & AI Advisor
-- This migration adds tables for rulepacks, filing workflows, assistant tools, and scenario planning

-- Rulepack Registry table (Chunk 1)
CREATE TABLE IF NOT EXISTS rulepack_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Rulepack identification
    jurisdiction VARCHAR(50) NOT NULL, -- 'GB', 'US', 'US-CA', 'CA', 'MX', 'EU'
    jurisdiction_code VARCHAR(50), -- Full jurisdiction identifier
    version VARCHAR(50) NOT NULL, -- Semantic version (e.g., '1.2.3')
    
    -- Status and lifecycle
    status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'pending_approval', 'active', 'deprecated', 'archived')) DEFAULT 'draft',
    is_active BOOLEAN DEFAULT false,
    
    -- Metadata
    checksum VARCHAR(255) NOT NULL, -- SHA-256 hash of rulepack content
    effective_from TIMESTAMP WITH TIME ZONE,
    effective_to TIMESTAMP WITH TIME ZONE,
    
    -- Rulepack content
    rulepack_data JSONB NOT NULL, -- Full rulepack JSON
    metadata JSONB DEFAULT '{}'::jsonb, -- Additional metadata (author, description, etc.)
    
    -- Regression tests
    regression_tests JSONB DEFAULT '[]'::jsonb, -- Array of test fixtures
    
    -- Approval workflow
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(jurisdiction, version)
);

CREATE INDEX IF NOT EXISTS idx_rulepack_registry_jurisdiction ON rulepack_registry(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_rulepack_registry_status ON rulepack_registry(status);
CREATE INDEX IF NOT EXISTS idx_rulepack_registry_active ON rulepack_registry(is_active);
CREATE INDEX IF NOT EXISTS idx_rulepack_registry_effective ON rulepack_registry(effective_from, effective_to);

-- Rulepack Regression Runs table (Chunk 1)
CREATE TABLE IF NOT EXISTS rulepack_regression_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rulepack_id UUID NOT NULL REFERENCES rulepack_registry(id) ON DELETE CASCADE,
    
    -- Run details
    run_type VARCHAR(20) NOT NULL CHECK (run_type IN ('pre_activation', 'scheduled', 'manual')) DEFAULT 'manual',
    status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'passed', 'failed', 'partial')) DEFAULT 'running',
    
    -- Results
    total_tests INTEGER DEFAULT 0,
    passed_tests INTEGER DEFAULT 0,
    failed_tests INTEGER DEFAULT 0,
    test_results JSONB DEFAULT '[]'::jsonb, -- Array of {testId, status, error, duration}
    
    -- Execution
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    executed_by UUID REFERENCES users(id),
    
    -- Metadata
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rulepack_regression_runs_rulepack ON rulepack_regression_runs(rulepack_id);
CREATE INDEX IF NOT EXISTS idx_rulepack_regression_runs_status ON rulepack_regression_runs(status);
CREATE INDEX IF NOT EXISTS idx_rulepack_regression_runs_started ON rulepack_regression_runs(started_at);

-- Filing Workflows table (Chunk 2)
CREATE TABLE IF NOT EXISTS filing_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Workflow status
    status VARCHAR(30) NOT NULL CHECK (status IN (
        'draft', 'ready_for_review', 'approved', 'submitted', 'accepted',
        'rejected', 'failed', 'amended', 'cancelled'
    )) DEFAULT 'draft',
    
    -- Lifecycle tracking
    draft_generated_at TIMESTAMP WITH TIME ZONE,
    ready_for_review_at TIMESTAMP WITH TIME ZONE,
    approved_at TIMESTAMP WITH TIME ZONE,
    submitted_at TIMESTAMP WITH TIME ZONE,
    accepted_at TIMESTAMP WITH TIME ZONE,
    rejected_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    
    -- Assignment
    assigned_to UUID REFERENCES users(id),
    assigned_by UUID REFERENCES users(id),
    
    -- Supporting evidence
    supporting_documents JSONB DEFAULT '[]'::jsonb, -- Array of document IDs
    ai_explanation TEXT, -- AI-generated explanation of filing
    
    -- Submission details
    submission_payload JSONB, -- Payload sent to government API
    submission_response JSONB, -- Response from government API
    submission_receipt_id VARCHAR(255), -- Government receipt/confirmation ID
    
    -- Receipt storage
    receipt_storage_key VARCHAR(500), -- S3 key for receipt document
    receipt_hash VARCHAR(255), -- SHA-256 hash of receipt for verification
    
    -- Metadata
    model_version VARCHAR(50), -- Model version used for calculation
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filing_workflows_filing ON filing_workflows(filing_id);
CREATE INDEX IF NOT EXISTS idx_filing_workflows_tenant ON filing_workflows(tenant_id);
CREATE INDEX IF NOT EXISTS idx_filing_workflows_status ON filing_workflows(status);
CREATE INDEX IF NOT EXISTS idx_filing_workflows_assigned ON filing_workflows(assigned_to);

-- Filing Calendars table (Chunk 2)
CREATE TABLE IF NOT EXISTS filing_calendars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Filing details
    jurisdiction VARCHAR(50) NOT NULL,
    filing_type VARCHAR(50) NOT NULL, -- 'vat', 'gst', 'sales_tax', 'paye', 'payroll', 'income_tax'
    frequency VARCHAR(20) NOT NULL, -- 'monthly', 'quarterly', 'annually', 'one_time'
    
    -- Schedule
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    period_start TIMESTAMP WITH TIME ZONE,
    period_end TIMESTAMP WITH TIME ZONE,
    
    -- Configuration
    auto_generate_draft BOOLEAN DEFAULT true,
    days_before_due INTEGER DEFAULT 7, -- Generate draft N days before due date
    reminder_days INTEGER[] DEFAULT ARRAY[30, 14, 7, 1], -- Days before due to send reminders
    
    -- Status
    draft_generated BOOLEAN DEFAULT false,
    draft_generated_at TIMESTAMP WITH TIME ZONE,
    filing_id UUID REFERENCES filings(id), -- Link to generated filing
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filing_calendars_tenant ON filing_calendars(tenant_id);
CREATE INDEX IF NOT EXISTS idx_filing_calendars_jurisdiction ON filing_calendars(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_filing_calendars_due_date ON filing_calendars(due_date);
CREATE INDEX IF NOT EXISTS idx_filing_calendars_draft_generated ON filing_calendars(draft_generated);

-- Filing Audit Trail table (Chunk 2)
CREATE TABLE IF NOT EXISTS filing_audit_trail (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
    workflow_id UUID REFERENCES filing_workflows(id) ON DELETE SET NULL,
    
    -- Action details
    action VARCHAR(50) NOT NULL, -- 'created', 'status_changed', 'approved', 'submitted', etc.
    previous_status VARCHAR(30),
    new_status VARCHAR(30),
    
    -- User and context
    user_id UUID REFERENCES users(id),
    user_name VARCHAR(255),
    user_email VARCHAR(255),
    
    -- Changes
    changes JSONB DEFAULT '{}'::jsonb, -- Detailed changes made
    comment TEXT,
    
    -- Model version
    model_version VARCHAR(50),
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filing_audit_trail_filing ON filing_audit_trail(filing_id);
CREATE INDEX IF NOT EXISTS idx_filing_audit_trail_workflow ON filing_audit_trail(workflow_id);
CREATE INDEX IF NOT EXISTS idx_filing_audit_trail_user ON filing_audit_trail(user_id);
CREATE INDEX IF NOT EXISTS idx_filing_audit_trail_created ON filing_audit_trail(created_at);

-- Assistant Audit Log table (Chunk 3)
CREATE TABLE IF NOT EXISTS assistant_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    conversation_id UUID, -- Links related messages in a conversation
    
    -- Action details
    action_type VARCHAR(50) NOT NULL, -- 'query', 'tool_call', 'filing_triggered', 'approval_requested'
    tool_name VARCHAR(100), -- Name of tool called (e.g., 'calculateTax', 'generateFilingDraft')
    tool_args JSONB, -- Arguments passed to tool
    
    -- Prompt and response
    prompt TEXT,
    response TEXT,
    reasoning_trace JSONB DEFAULT '[]'::jsonb, -- Array of tool calls and results
    
    -- Citations
    cited_rule_ids TEXT[], -- Array of rule IDs cited
    cited_documents UUID[], -- Array of document IDs cited
    rulepack_version VARCHAR(50), -- Rulepack version used
    
    -- User confirmation
    user_confirmed BOOLEAN DEFAULT false,
    user_confirmed_at TIMESTAMP WITH TIME ZONE,
    user_rejected BOOLEAN DEFAULT false,
    user_rejected_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    
    -- Result
    result JSONB, -- Tool execution result
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_audit_log_tenant ON assistant_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_assistant_audit_log_user ON assistant_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_assistant_audit_log_conversation ON assistant_audit_log(conversation_id);
CREATE INDEX IF NOT EXISTS idx_assistant_audit_log_tool ON assistant_audit_log(tool_name);
CREATE INDEX IF NOT EXISTS idx_assistant_audit_log_created ON assistant_audit_log(created_at);

-- Assistant Conversation Memory table (Chunk 3)
CREATE TABLE IF NOT EXISTS assistant_conversation_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    conversation_id UUID NOT NULL,
    
    -- Memory content
    context JSONB DEFAULT '{}'::jsonb, -- Conversation context
    rulepack_versions JSONB DEFAULT '{}'::jsonb, -- {jurisdiction: version} mapping
    document_citations UUID[], -- Array of document IDs referenced
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_assistant_conversation_memory_tenant ON assistant_conversation_memory(tenant_id);
CREATE INDEX IF NOT EXISTS idx_assistant_conversation_memory_conversation ON assistant_conversation_memory(conversation_id);

-- Tax Scenarios table (Chunk 4)
CREATE TABLE IF NOT EXISTS tax_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Scenario details
    scenario_name VARCHAR(255) NOT NULL,
    scenario_description TEXT,
    scenario_type VARCHAR(50) NOT NULL CHECK (scenario_type IN ('forecast', 'optimization', 'what_if', 'restructuring')),
    
    -- Input parameters
    input_parameters JSONB NOT NULL, -- {revenue: number, expenses: number, jurisdictions: [], etc.}
    adjustments JSONB DEFAULT '{}'::jsonb, -- Specific adjustments made
    
    -- Results
    projected_liabilities JSONB DEFAULT '{}'::jsonb, -- {jurisdiction: amount} mapping
    savings_amount DECIMAL(10, 2),
    savings_percentage DECIMAL(5, 2),
    risk_score DECIMAL(5, 4), -- 0-1 risk score
    metrics JSONB DEFAULT '{}'::jsonb, -- Additional metrics
    
    -- AI commentary
    ai_commentary TEXT,
    recommendations JSONB DEFAULT '[]'::jsonb, -- Array of recommendation objects
    
    -- Status
    status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'running', 'completed', 'failed')) DEFAULT 'draft',
    
    -- Execution
    executed_at TIMESTAMP WITH TIME ZONE,
    execution_time_ms INTEGER,
    
    -- Metadata
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_scenarios_tenant ON tax_scenarios(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tax_scenarios_type ON tax_scenarios(scenario_type);
CREATE INDEX IF NOT EXISTS idx_tax_scenarios_status ON tax_scenarios(status);
CREATE INDEX IF NOT EXISTS idx_tax_scenarios_created ON tax_scenarios(created_at);

-- Tax Optimization Jobs table (Chunk 4)
CREATE TABLE IF NOT EXISTS tax_optimization_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    scenario_id UUID REFERENCES tax_scenarios(id) ON DELETE SET NULL,
    
    -- Job details
    job_type VARCHAR(50) NOT NULL, -- 'revenue_timing', 'expense_timing', 'entity_structure', 'jurisdiction_optimization'
    status VARCHAR(20) NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')) DEFAULT 'queued',
    
    -- Parameters
    parameters JSONB DEFAULT '{}'::jsonb,
    
    -- Results
    optimization_results JSONB DEFAULT '{}'::jsonb,
    savings_identified DECIMAL(10, 2),
    risk_assessment JSONB DEFAULT '{}'::jsonb,
    
    -- Execution
    queued_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_optimization_jobs_tenant ON tax_optimization_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tax_optimization_jobs_scenario ON tax_optimization_jobs(scenario_id);
CREATE INDEX IF NOT EXISTS idx_tax_optimization_jobs_status ON tax_optimization_jobs(status);

-- Tax Anomaly Detections table (Chunk 4)
CREATE TABLE IF NOT EXISTS tax_anomaly_detections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Anomaly details
    anomaly_type VARCHAR(50) NOT NULL, -- 'variance', 'missing_filing', 'unusual_pattern', 'threshold_breach'
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
    confidence DECIMAL(5, 4) NOT NULL, -- 0-1 confidence score
    
    -- Detection details
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    period_start TIMESTAMP WITH TIME ZONE,
    period_end TIMESTAMP WITH TIME ZONE,
    jurisdiction VARCHAR(50),
    
    -- Impact
    impacted_filings UUID[], -- Array of filing IDs
    impacted_transactions UUID[], -- Array of transaction IDs
    impact_description TEXT,
    
    -- Analysis
    detected_value DECIMAL(10, 2),
    expected_value DECIMAL(10, 2),
    variance_percentage DECIMAL(5, 2),
    analysis JSONB DEFAULT '{}'::jsonb,
    
    -- Resolution
    status VARCHAR(20) NOT NULL CHECK (status IN ('open', 'investigating', 'resolved', 'ignored')) DEFAULT 'open',
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id),
    resolution_notes TEXT,
    
    -- Task creation
    task_created BOOLEAN DEFAULT false,
    task_id UUID, -- Link to created task
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tax_anomaly_detections_tenant ON tax_anomaly_detections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tax_anomaly_detections_type ON tax_anomaly_detections(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_tax_anomaly_detections_severity ON tax_anomaly_detections(severity);
CREATE INDEX IF NOT EXISTS idx_tax_anomaly_detections_status ON tax_anomaly_detections(status);
CREATE INDEX IF NOT EXISTS idx_tax_anomaly_detections_detected ON tax_anomaly_detections(detected_at);

-- Add updated_at triggers
CREATE TRIGGER update_rulepack_registry_updated_at BEFORE UPDATE ON rulepack_registry FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_filing_workflows_updated_at BEFORE UPDATE ON filing_workflows FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_filing_calendars_updated_at BEFORE UPDATE ON filing_calendars FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tax_scenarios_updated_at BEFORE UPDATE ON tax_scenarios FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_assistant_conversation_memory_updated_at BEFORE UPDATE ON assistant_conversation_memory FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tax_anomaly_detections_updated_at BEFORE UPDATE ON tax_anomaly_detections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
