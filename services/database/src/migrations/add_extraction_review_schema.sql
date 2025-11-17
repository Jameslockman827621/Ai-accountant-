-- Extraction and Review Workflows Schema
-- Migration: add_extraction_review_schema.sql
-- Description: Model registry, calibration, reasoning traces, and review workflows

-- Model Registry (MLflow-like tracking)
CREATE TABLE IF NOT EXISTS model_registry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_name VARCHAR(255) NOT NULL,
    model_version VARCHAR(100) NOT NULL,
    model_type VARCHAR(50) NOT NULL CHECK (model_type IN ('ocr', 'classification', 'extraction', 'layout', 'semantic')),
    training_data_hash VARCHAR(64) NOT NULL,
    model_storage_path VARCHAR(500),
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    hyperparameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    rollout_stage VARCHAR(50) NOT NULL DEFAULT 'development' CHECK (rollout_stage IN ('development', 'staging', 'production', 'deprecated')),
    performance_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(model_name, model_version)
);

CREATE INDEX idx_model_registry_name ON model_registry(model_name);
CREATE INDEX idx_model_registry_type ON model_registry(model_type);
CREATE INDEX idx_model_registry_stage ON model_registry(rollout_stage);
CREATE INDEX idx_model_registry_created_at ON model_registry(created_at);

-- Extraction Calibration (Platt scaling, isotonic regression)
CREATE TABLE IF NOT EXISTS extraction_calibration (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES model_registry(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    calibration_type VARCHAR(50) NOT NULL CHECK (calibration_type IN ('platt', 'isotonic', 'temperature')),
    calibration_params JSONB NOT NULL DEFAULT '{}'::jsonb,
    reliability_score DECIMAL(5, 4) NOT NULL, -- 0-1 scale
    calibration_data_hash VARCHAR(64),
    validated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(model_id, field_name)
);

CREATE INDEX idx_extraction_calibration_model ON extraction_calibration(model_id);
CREATE INDEX idx_extraction_calibration_field ON extraction_calibration(field_name);
CREATE INDEX idx_extraction_calibration_reliability ON extraction_calibration(reliability_score);

-- Reasoning Traces (structured explanations)
CREATE TABLE IF NOT EXISTS reasoning_traces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    model_id UUID REFERENCES model_registry(id),
    trace_type VARCHAR(50) NOT NULL CHECK (trace_type IN ('classification', 'extraction', 'validation', 'posting')),
    features JSONB NOT NULL DEFAULT '{}'::jsonb, -- Feature values used
    weights JSONB NOT NULL DEFAULT '{}'::jsonb, -- Feature weights/importance
    decision_path JSONB NOT NULL DEFAULT '[]'::jsonb, -- Step-by-step reasoning
    confidence_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb, -- Per-feature confidence
    alternative_predictions JSONB NOT NULL DEFAULT '[]'::jsonb, -- Top-k alternatives
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reasoning_traces_document ON reasoning_traces(document_id);
CREATE INDEX idx_reasoning_traces_model ON reasoning_traces(model_id);
CREATE INDEX idx_reasoning_traces_type ON reasoning_traces(trace_type);

-- Review Queue (enhanced with risk-based prioritization)
CREATE TABLE IF NOT EXISTS review_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    priority_score DECIMAL(5, 2) NOT NULL DEFAULT 0, -- Higher = more urgent
    risk_level VARCHAR(20) NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    risk_factors JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of risk factors
    assigned_to UUID REFERENCES users(id),
    assigned_at TIMESTAMP WITH TIME ZONE,
    reviewer_skill_required VARCHAR(50), -- e.g., 'senior_accountant', 'tax_specialist'
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_review', 'approved', 'rejected', 'escalated')),
    sla_deadline TIMESTAMP WITH TIME ZONE,
    time_to_first_review INTEGER, -- seconds
    review_completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(document_id)
);

CREATE INDEX idx_review_queue_tenant_id ON review_queue(tenant_id);
CREATE INDEX idx_review_queue_status ON review_queue(status);
CREATE INDEX idx_review_queue_priority ON review_queue(priority_score DESC);
CREATE INDEX idx_review_queue_risk_level ON review_queue(risk_level);
CREATE INDEX idx_review_queue_assigned_to ON review_queue(assigned_to);
CREATE INDEX idx_review_queue_sla_deadline ON review_queue(sla_deadline) WHERE sla_deadline IS NOT NULL;

-- Reviewer Actions (feedback loop)
CREATE TABLE IF NOT EXISTS reviewer_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    review_queue_id UUID NOT NULL REFERENCES review_queue(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id),
    action_type VARCHAR(50) NOT NULL CHECK (action_type IN ('approve', 'edit', 'reject', 'escalate', 'request_info')),
    field_corrections JSONB NOT NULL DEFAULT '{}'::jsonb, -- Field-level corrections
    ledger_corrections JSONB NOT NULL DEFAULT '{}'::jsonb, -- Ledger posting corrections
    notes TEXT,
    confidence_override DECIMAL(5, 4), -- Reviewer's confidence assessment
    processing_time_seconds INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviewer_actions_review_queue ON reviewer_actions(review_queue_id);
CREATE INDEX idx_reviewer_actions_reviewer ON reviewer_actions(reviewer_id);
CREATE INDEX idx_reviewer_actions_type ON reviewer_actions(action_type);
CREATE INDEX idx_reviewer_actions_created_at ON reviewer_actions(created_at);

-- Reviewer Skills & Performance
CREATE TABLE IF NOT EXISTS reviewer_skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_type VARCHAR(50) NOT NULL CHECK (skill_type IN ('general', 'tax_specialist', 'senior_accountant', 'compliance', 'audit')),
    proficiency_level INTEGER NOT NULL DEFAULT 1 CHECK (proficiency_level BETWEEN 1 AND 5),
    documents_reviewed INTEGER NOT NULL DEFAULT 0,
    average_review_time_seconds INTEGER,
    accuracy_rate DECIMAL(5, 4), -- Based on feedback
    specialties TEXT[], -- Array of specialties
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, skill_type)
);

CREATE INDEX idx_reviewer_skills_user_id ON reviewer_skills(user_id);
CREATE INDEX idx_reviewer_skills_type ON reviewer_skills(skill_type);
CREATE INDEX idx_reviewer_skills_proficiency ON reviewer_skills(proficiency_level);

-- Quality Metrics (composite quality scores)
CREATE TABLE IF NOT EXISTS quality_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    accuracy_score DECIMAL(5, 4) NOT NULL, -- Overall accuracy
    completeness_score DECIMAL(5, 4) NOT NULL, -- Field completeness
    compliance_risk_score DECIMAL(5, 4) NOT NULL, -- Compliance risk (0 = no risk, 1 = high risk)
    composite_quality_score DECIMAL(5, 4) NOT NULL, -- Weighted composite
    field_level_metrics JSONB NOT NULL DEFAULT '{}'::jsonb, -- Per-field metrics
    calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    model_version VARCHAR(100),
    UNIQUE(document_id)
);

CREATE INDEX idx_quality_metrics_document ON quality_metrics(document_id);
CREATE INDEX idx_quality_metrics_composite ON quality_metrics(composite_quality_score);
CREATE INDEX idx_quality_metrics_compliance_risk ON quality_metrics(compliance_risk_score);

-- Model Training Jobs (retraining pipeline)
CREATE TABLE IF NOT EXISTS model_training_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES model_registry(id) ON DELETE CASCADE,
    training_data_version VARCHAR(100),
    training_data_hash VARCHAR(64),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER,
    metrics_before JSONB,
    metrics_after JSONB,
    accuracy_regression DECIMAL(5, 4), -- Negative = improvement, positive = regression
    drift_detected BOOLEAN NOT NULL DEFAULT false,
    drift_details JSONB,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_model_training_jobs_model ON model_training_jobs(model_id);
CREATE INDEX idx_model_training_jobs_status ON model_training_jobs(status);
CREATE INDEX idx_model_training_jobs_drift ON model_training_jobs(drift_detected) WHERE drift_detected = true;

-- SLA Metrics (time-to-first-review, completion rate)
CREATE TABLE IF NOT EXISTS sla_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    metric_type VARCHAR(50) NOT NULL CHECK (metric_type IN ('time_to_first_review', 'completion_rate', 'sla_breach_count')),
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical', 'all')),
    target_value DECIMAL(10, 2), -- Target metric value
    actual_value DECIMAL(10, 2), -- Actual metric value
    unit VARCHAR(20), -- e.g., 'seconds', 'percentage', 'count'
    breach_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, period_start, period_end, metric_type, risk_level)
);

CREATE INDEX idx_sla_metrics_tenant_id ON sla_metrics(tenant_id);
CREATE INDEX idx_sla_metrics_period ON sla_metrics(period_start, period_end);
CREATE INDEX idx_sla_metrics_type ON sla_metrics(metric_type);

-- Row Level Security
ALTER TABLE model_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_calibration ENABLE ROW LEVEL SECURITY;
ALTER TABLE reasoning_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviewer_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviewer_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_training_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY tenant_isolation_model_registry ON model_registry
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_extraction_calibration ON extraction_calibration
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_reasoning_traces ON reasoning_traces
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_review_queue ON review_queue
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_reviewer_actions ON reviewer_actions
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_reviewer_skills ON reviewer_skills
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_quality_metrics ON quality_metrics
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_model_training_jobs ON model_training_jobs
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_sla_metrics ON sla_metrics
    FOR ALL USING (true);

-- Triggers for updated_at
CREATE TRIGGER update_model_registry_updated_at BEFORE UPDATE ON model_registry
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_extraction_calibration_updated_at BEFORE UPDATE ON extraction_calibration
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_review_queue_updated_at BEFORE UPDATE ON review_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reviewer_skills_updated_at BEFORE UPDATE ON reviewer_skills
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_model_training_jobs_updated_at BEFORE UPDATE ON model_training_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Review Queue Autosave table (for optimistic locking and draft saving)
CREATE TABLE IF NOT EXISTS review_queue_autosave (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    field_edits JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,
    saved_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (document_id, tenant_id)
);

CREATE INDEX idx_review_queue_autosave_tenant ON review_queue_autosave(tenant_id);
CREATE INDEX idx_review_queue_autosave_saved_at ON review_queue_autosave(saved_at);
