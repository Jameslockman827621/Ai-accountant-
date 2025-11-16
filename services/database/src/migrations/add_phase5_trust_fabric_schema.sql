-- Phase 5 Trust Fabric Schema

-- Golden Dataset Repository
CREATE TABLE IF NOT EXISTS golden_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  jurisdiction VARCHAR(50),
  filing_type VARCHAR(100),
  document_type VARCHAR(100),
  version VARCHAR(50) NOT NULL,
  description TEXT,
  
  -- Dataset Content
  samples JSONB NOT NULL, -- Array of {input, expected_output, tolerance, annotations}
  metadata JSONB,
  
  -- Versioning
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by UUID,
  is_active BOOLEAN DEFAULT true,
  
  UNIQUE(name, version)
);

CREATE INDEX idx_golden_datasets_jurisdiction ON golden_datasets(jurisdiction, filing_type, is_active);

-- Regression Test Results
CREATE TABLE IF NOT EXISTS regression_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_suite VARCHAR(255) NOT NULL,
  test_name VARCHAR(255) NOT NULL,
  golden_dataset_id UUID REFERENCES golden_datasets(id),
  
  -- Test Execution
  status VARCHAR(50) NOT NULL, -- pass, fail, skipped, error
  execution_time_ms INTEGER,
  run_at TIMESTAMP NOT NULL DEFAULT NOW(),
  run_by VARCHAR(255), -- CI pipeline, user, etc.
  
  -- Results
  expected_output JSONB,
  actual_output JSONB,
  diff JSONB,
  error_message TEXT,
  
  -- Context
  service_version VARCHAR(50),
  model_version VARCHAR(50),
  environment VARCHAR(50), -- dev, staging, prod
  
  metadata JSONB
);

CREATE INDEX idx_regression_test_results_suite ON regression_test_results(test_suite, run_at DESC);
CREATE INDEX idx_regression_test_results_status ON regression_test_results(status, run_at DESC);

-- Model Registry
CREATE TABLE IF NOT EXISTS model_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name VARCHAR(255) NOT NULL,
  model_type VARCHAR(100) NOT NULL, -- classification, extraction, prediction
  version VARCHAR(50) NOT NULL,
  
  -- Training
  training_data_hash VARCHAR(64),
  training_data_lineage JSONB,
  training_config JSONB,
  training_metrics JSONB,
  
  -- Evaluation
  evaluation_metrics JSONB,
  golden_dataset_scores JSONB,
  fairness_metrics JSONB,
  
  -- Deployment
  status VARCHAR(50) NOT NULL DEFAULT 'draft', -- draft, training, evaluating, approved, deployed, deprecated
  deployed_at TIMESTAMP,
  deployed_by UUID,
  rollout_percentage INTEGER DEFAULT 0,
  
  -- Ownership
  owner_team VARCHAR(100),
  owner_email VARCHAR(255),
  
  -- Artifacts
  model_artifact_path VARCHAR(500),
  explainability_artifacts JSONB,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  UNIQUE(model_name, version)
);

CREATE INDEX idx_model_registry_status ON model_registry(status, model_type);
CREATE INDEX idx_model_registry_deployed ON model_registry(deployed_at DESC);

-- Model Drift Monitoring
CREATE TABLE IF NOT EXISTS model_drift_detections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES model_registry(id) ON DELETE CASCADE,
  
  -- Drift Detection
  drift_type VARCHAR(100) NOT NULL, -- data_drift, concept_drift, prediction_drift
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  severity VARCHAR(50) NOT NULL, -- low, medium, high, critical
  
  -- Metrics
  baseline_distribution JSONB,
  current_distribution JSONB,
  drift_score NUMERIC,
  statistical_test VARCHAR(100),
  p_value NUMERIC,
  
  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'open', -- open, investigating, resolved, false_positive
  resolved_at TIMESTAMP,
  resolved_by UUID,
  resolution_notes TEXT,
  
  -- Alert
  alert_sent BOOLEAN DEFAULT false,
  alert_sent_at TIMESTAMP,
  
  metadata JSONB
);

CREATE INDEX idx_model_drift_model ON model_drift_detections(model_id, detected_at DESC);
CREATE INDEX idx_model_drift_status ON model_drift_detections(status, severity);

-- Security Events & Incidents
CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Event Details
  event_type VARCHAR(100) NOT NULL, -- login_failure, unauthorized_access, data_breach, policy_violation
  severity VARCHAR(50) NOT NULL, -- low, medium, high, critical
  event_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Context
  source_ip VARCHAR(45),
  user_agent TEXT,
  resource_type VARCHAR(100),
  resource_id UUID,
  action VARCHAR(100),
  
  -- Details
  description TEXT,
  raw_event JSONB,
  
  -- Response
  status VARCHAR(50) NOT NULL DEFAULT 'open', -- open, investigating, resolved, false_positive
  assigned_to UUID,
  resolved_at TIMESTAMP,
  resolution_notes TEXT,
  
  -- Compliance
  reported_to_authorities BOOLEAN DEFAULT false,
  reported_at TIMESTAMP,
  
  metadata JSONB
);

CREATE INDEX idx_security_events_type ON security_events(event_type, event_timestamp DESC);
CREATE INDEX idx_security_events_severity ON security_events(severity, status);
CREATE INDEX idx_security_events_tenant ON security_events(tenant_id, event_timestamp DESC);

-- Incident Management
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_number VARCHAR(50) NOT NULL UNIQUE,
  
  -- Classification
  severity VARCHAR(50) NOT NULL, -- sev1, sev2, sev3, sev4
  incident_type VARCHAR(100) NOT NULL, -- security, availability, data_loss, performance
  status VARCHAR(50) NOT NULL DEFAULT 'open', -- open, investigating, mitigated, resolved, postmortem
  
  -- Timeline
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reported_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  mitigated_at TIMESTAMP,
  resolved_at TIMESTAMP,
  
  -- Assignment
  detected_by UUID,
  assigned_to UUID,
  on_call_rotation VARCHAR(100),
  
  -- Details
  title VARCHAR(255) NOT NULL,
  description TEXT,
  affected_services TEXT[],
  affected_tenants UUID[],
  customer_impact TEXT,
  
  -- Metrics
  mttd_minutes INTEGER, -- Mean Time To Detect
  mttr_minutes INTEGER, -- Mean Time To Resolve
  mtta_minutes INTEGER, -- Mean Time To Acknowledge
  
  -- Postmortem
  root_cause TEXT,
  resolution_steps TEXT,
  postmortem_document_url VARCHAR(500),
  lessons_learned TEXT,
  action_items JSONB,
  
  metadata JSONB
);

CREATE INDEX idx_incidents_severity_status ON incidents(severity, status, detected_at DESC);
CREATE INDEX idx_incidents_type ON incidents(incident_type, detected_at DESC);

-- SLO Tracking
CREATE TABLE IF NOT EXISTS slo_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name VARCHAR(100) NOT NULL,
  slo_name VARCHAR(255) NOT NULL,
  slo_type VARCHAR(100) NOT NULL, -- availability, latency, error_rate, freshness
  
  -- SLO Definition
  target_percentage NUMERIC NOT NULL, -- e.g., 99.9
  measurement_window_hours INTEGER NOT NULL, -- e.g., 30 days = 720 hours
  current_percentage NUMERIC,
  
  -- Error Budget
  error_budget_total NUMERIC,
  error_budget_consumed NUMERIC,
  error_budget_remaining NUMERIC,
  error_budget_burn_rate NUMERIC,
  
  -- Status
  status VARCHAR(50) NOT NULL, -- on_track, at_risk, breached
  last_breach_at TIMESTAMP,
  
  -- Measurement Period
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  measured_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  metadata JSONB,
  UNIQUE(service_name, slo_name, period_start)
);

CREATE INDEX idx_slo_tracking_service ON slo_tracking(service_name, measured_at DESC);
CREATE INDEX idx_slo_tracking_status ON slo_tracking(status, measured_at DESC);

-- Data Residency & Classification
CREATE TABLE IF NOT EXISTS data_classification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Classification
  data_type VARCHAR(100) NOT NULL, -- pii, financial, health, public
  sensitivity_level VARCHAR(50) NOT NULL, -- public, internal, confidential, restricted
  jurisdiction VARCHAR(50),
  data_residency_region VARCHAR(50), -- us, uk, eu, ca, global
  
  -- Storage
  storage_location VARCHAR(100),
  encryption_at_rest BOOLEAN DEFAULT true,
  encryption_in_transit BOOLEAN DEFAULT true,
  
  -- Retention
  retention_policy_days INTEGER,
  auto_delete_enabled BOOLEAN DEFAULT false,
  
  -- Access
  access_controls JSONB,
  allowed_regions TEXT[],
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_data_classification_tenant ON data_classification(tenant_id, data_type);
CREATE INDEX idx_data_classification_residency ON data_classification(data_residency_region, jurisdiction);

-- Secret Rotation Log
CREATE TABLE IF NOT EXISTS secret_rotation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_name VARCHAR(255) NOT NULL,
  secret_type VARCHAR(100) NOT NULL, -- api_key, oauth_token, database_password, encryption_key
  
  -- Rotation
  rotated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  rotated_by VARCHAR(255), -- system, user_id
  rotation_method VARCHAR(50), -- automatic, manual
  
  -- Details
  old_secret_hash VARCHAR(64),
  new_secret_hash VARCHAR(64),
  rotation_policy VARCHAR(100),
  next_rotation_due TIMESTAMP,
  
  -- Status
  status VARCHAR(50) NOT NULL, -- success, failed, partial
  error_message TEXT,
  
  metadata JSONB
);

CREATE INDEX idx_secret_rotation_name ON secret_rotation_log(secret_name, rotated_at DESC);
CREATE INDEX idx_secret_rotation_due ON secret_rotation_log(next_rotation_due, status);

-- Access Reviews
CREATE TABLE IF NOT EXISTS access_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_type VARCHAR(100) NOT NULL, -- user_access, role_permissions, api_keys, service_accounts
  
  -- Scope
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  resource_type VARCHAR(100),
  resource_id UUID,
  
  -- Review
  reviewed_by UUID NOT NULL,
  reviewed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  review_status VARCHAR(50) NOT NULL, -- approved, revoked, needs_justification
  
  -- Findings
  current_permissions JSONB,
  recommended_changes JSONB,
  justification TEXT,
  review_notes TEXT,
  
  -- Follow-up
  action_taken VARCHAR(100),
  action_taken_at TIMESTAMP,
  action_taken_by UUID,
  
  metadata JSONB
);

CREATE INDEX idx_access_reviews_tenant ON access_reviews(tenant_id, reviewed_at DESC);
CREATE INDEX idx_access_reviews_user ON access_reviews(user_id, review_status);

-- Compliance Evidence
CREATE TABLE IF NOT EXISTS compliance_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  compliance_framework VARCHAR(100) NOT NULL, -- soc2, iso27001, gdpr, hipaa
  control_id VARCHAR(255) NOT NULL,
  control_name VARCHAR(255) NOT NULL,
  
  -- Evidence
  evidence_type VARCHAR(100) NOT NULL, -- policy, procedure, log, test_result, audit_report
  evidence_url VARCHAR(500),
  evidence_data JSONB,
  
  -- Status
  status VARCHAR(50) NOT NULL, -- draft, reviewed, approved, expired
  reviewed_by UUID,
  reviewed_at TIMESTAMP,
  approved_by UUID,
  approved_at TIMESTAMP,
  
  -- Validity
  effective_from DATE,
  effective_to DATE,
  last_verified_at TIMESTAMP,
  next_review_due DATE,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  UNIQUE(compliance_framework, control_id, effective_from)
);

CREATE INDEX idx_compliance_evidence_framework ON compliance_evidence(compliance_framework, status);
CREATE INDEX idx_compliance_evidence_review_due ON compliance_evidence(next_review_due, status);

-- Backup & Restore Logs
CREATE TABLE IF NOT EXISTS backup_restore_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type VARCHAR(100) NOT NULL, -- full, incremental, differential
  service_name VARCHAR(100) NOT NULL,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Backup
  backup_started_at TIMESTAMP NOT NULL,
  backup_completed_at TIMESTAMP,
  backup_status VARCHAR(50) NOT NULL, -- in_progress, completed, failed
  backup_size_bytes BIGINT,
  backup_location VARCHAR(500),
  backup_encrypted BOOLEAN DEFAULT true,
  
  -- Restore
  restore_requested_at TIMESTAMP,
  restore_completed_at TIMESTAMP,
  restore_status VARCHAR(50),
  restore_to_point TIMESTAMP,
  restored_by UUID,
  
  -- Retention
  retention_until TIMESTAMP,
  deleted_at TIMESTAMP,
  
  -- Verification
  verified_at TIMESTAMP,
  verification_status VARCHAR(50),
  verification_notes TEXT,
  
  metadata JSONB
);

CREATE INDEX idx_backup_restore_service ON backup_restore_logs(service_name, backup_started_at DESC);
CREATE INDEX idx_backup_restore_tenant ON backup_restore_logs(tenant_id, backup_started_at DESC);
CREATE INDEX idx_backup_restore_status ON backup_restore_logs(backup_status, restore_status);

-- Chaos Test Results
CREATE TABLE IF NOT EXISTS chaos_test_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_name VARCHAR(255) NOT NULL,
  test_type VARCHAR(100) NOT NULL, -- connector_outage, queue_delay, db_failover, service_degradation
  
  -- Execution
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  duration_seconds INTEGER,
  status VARCHAR(50) NOT NULL, -- running, completed, failed, cancelled
  
  -- Impact
  affected_services TEXT[],
  affected_tenants UUID[],
  error_rate_before NUMERIC,
  error_rate_during NUMERIC,
  error_rate_after NUMERIC,
  recovery_time_seconds INTEGER,
  
  -- Results
  test_passed BOOLEAN,
  failure_points JSONB,
  recovery_actions JSONB,
  lessons_learned TEXT,
  
  -- Context
  environment VARCHAR(50),
  run_by VARCHAR(255),
  
  metadata JSONB
);

CREATE INDEX idx_chaos_test_results_type ON chaos_test_results(test_type, started_at DESC);
CREATE INDEX idx_chaos_test_results_status ON chaos_test_results(status, test_passed);

-- Updated at triggers
CREATE TRIGGER update_model_registry_updated_at
  BEFORE UPDATE ON model_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_data_classification_updated_at
  BEFORE UPDATE ON data_classification
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_compliance_evidence_updated_at
  BEFORE UPDATE ON compliance_evidence
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
