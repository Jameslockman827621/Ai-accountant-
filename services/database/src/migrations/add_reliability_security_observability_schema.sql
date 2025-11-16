-- Migration: Add tables for Reliability, Security & Observability
-- This migration adds tables for SLOs, permissions, backups, and audit logs

-- SLO Definitions table (Chunk 2)
CREATE TABLE IF NOT EXISTS slo_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- SLO details
    slo_name VARCHAR(255) NOT NULL UNIQUE,
    service_name VARCHAR(100) NOT NULL,
    metric_name VARCHAR(255) NOT NULL, -- e.g., 'request_latency_p95', 'error_rate'
    target_value DECIMAL(10, 4) NOT NULL, -- Target value (e.g., 0.995 for 99.5%)
    window_days INTEGER DEFAULT 30, -- Rolling window in days
    
    -- Thresholds
    warning_threshold DECIMAL(10, 4), -- Warning level
    critical_threshold DECIMAL(10, 4), -- Critical level
    
    -- Status
    enabled BOOLEAN DEFAULT true,
    
    -- Metadata
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slo_definitions_service ON slo_definitions(service_name);
CREATE INDEX IF NOT EXISTS idx_slo_definitions_enabled ON slo_definitions(enabled);

-- SLO Measurements table (Chunk 2)
CREATE TABLE IF NOT EXISTS slo_measurements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slo_id UUID NOT NULL REFERENCES slo_definitions(id) ON DELETE CASCADE,
    
    -- Measurement
    measured_value DECIMAL(10, 4) NOT NULL,
    error_budget_remaining DECIMAL(10, 4), -- Remaining error budget percentage
    
    -- Status
    status VARCHAR(20) NOT NULL CHECK (status IN ('healthy', 'warning', 'breached')) DEFAULT 'healthy',
    
    -- Timestamp
    measured_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Metadata
    sample_count INTEGER,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_slo_measurements_slo ON slo_measurements(slo_id);
CREATE INDEX IF NOT EXISTS idx_slo_measurements_measured_at ON slo_measurements(measured_at);
CREATE INDEX IF NOT EXISTS idx_slo_measurements_status ON slo_measurements(status);

-- Alert Rules table (Chunk 2)
CREATE TABLE IF NOT EXISTS alert_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Rule details
    rule_name VARCHAR(255) NOT NULL,
    service_name VARCHAR(100),
    metric_name VARCHAR(255) NOT NULL,
    condition_type VARCHAR(50) NOT NULL, -- 'threshold', 'rate_of_change', 'anomaly'
    condition_config JSONB NOT NULL, -- Condition-specific configuration
    
    -- Actions
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('info', 'warning', 'critical')) DEFAULT 'warning',
    notification_channels JSONB DEFAULT '[]'::jsonb, -- Array of channels (slack, pagerduty, email)
    runbook_url VARCHAR(500),
    
    -- Status
    enabled BOOLEAN DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_service ON alert_rules(service_name);
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);

-- Alert Fires table (Chunk 2)
CREATE TABLE IF NOT EXISTS alert_fires (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_rule_id UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    
    -- Fire details
    fired_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('firing', 'resolved', 'acknowledged')) DEFAULT 'firing',
    
    -- Context
    metric_value DECIMAL(10, 4),
    threshold_value DECIMAL(10, 4),
    context JSONB DEFAULT '{}'::jsonb,
    
    -- Resolution
    resolved_by UUID REFERENCES users(id),
    resolution_notes TEXT,
    
    -- Metadata
    notification_sent BOOLEAN DEFAULT false,
    notification_sent_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_alert_fires_rule ON alert_fires(alert_rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_fires_status ON alert_fires(status);
CREATE INDEX IF NOT EXISTS idx_alert_fires_fired_at ON alert_fires(fired_at);

-- Permissions table (Chunk 3)
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Permission details
    permission_name VARCHAR(255) NOT NULL UNIQUE,
    resource_type VARCHAR(100) NOT NULL, -- 'document', 'filing', 'user', 'tenant', etc.
    action VARCHAR(100) NOT NULL, -- 'read', 'write', 'delete', 'admin', etc.
    
    -- Description
    description TEXT,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permissions_resource_type ON permissions(resource_type);
CREATE INDEX IF NOT EXISTS idx_permissions_action ON permissions(action);

-- Roles table (Chunk 3)
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Role details
    role_name VARCHAR(255) NOT NULL UNIQUE,
    role_type VARCHAR(50) NOT NULL CHECK (role_type IN ('system', 'custom')) DEFAULT 'custom',
    
    -- Description
    description TEXT,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roles_type ON roles(role_type);

-- Role Permissions table (Chunk 3)
CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    
    -- Conditions (for ABAC)
    conditions JSONB DEFAULT '{}'::jsonb, -- Attribute-based conditions
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);

-- User Roles table (Chunk 3)
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- Tenant-scoped role
    
    -- Assignment
    assigned_by UUID REFERENCES users(id),
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE, -- Optional expiration
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(user_id, role_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_tenant ON user_roles(tenant_id);

-- Access Requests table (Chunk 3)
CREATE TABLE IF NOT EXISTS access_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Request details
    requested_role_id UUID REFERENCES roles(id),
    requested_permission_id UUID REFERENCES permissions(id),
    reason TEXT NOT NULL,
    
    -- Status
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')) DEFAULT 'pending',
    
    -- Approval workflow
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_requests_user ON access_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_tenant ON access_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status);

-- Backup Catalog table (Chunk 4)
CREATE TABLE IF NOT EXISTS backup_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Backup details
    backup_type VARCHAR(50) NOT NULL CHECK (backup_type IN ('database', 'object_storage', 'full')) DEFAULT 'database',
    backup_name VARCHAR(255) NOT NULL,
    
    -- Storage
    storage_location VARCHAR(500) NOT NULL, -- S3 path, file path, etc.
    storage_size_bytes BIGINT,
    checksum VARCHAR(255), -- SHA-256 hash
    
    -- Backup metadata
    backup_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    backup_completed_at TIMESTAMP WITH TIME ZONE,
    backup_status VARCHAR(20) NOT NULL CHECK (backup_status IN ('in_progress', 'completed', 'failed')) DEFAULT 'in_progress',
    
    -- Point-in-time recovery
    pitr_timestamp TIMESTAMP WITH TIME ZONE, -- For PITR backups
    
    -- Retention
    retention_until TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_catalog_type ON backup_catalog(backup_type);
CREATE INDEX IF NOT EXISTS idx_backup_catalog_status ON backup_catalog(backup_status);
CREATE INDEX IF NOT EXISTS idx_backup_catalog_completed ON backup_catalog(backup_completed_at);

-- Backup Restore Tests table (Chunk 4)
CREATE TABLE IF NOT EXISTS backup_restore_tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_id UUID NOT NULL REFERENCES backup_catalog(id) ON DELETE CASCADE,
    
    -- Test details
    test_started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    test_completed_at TIMESTAMP WITH TIME ZONE,
    test_status VARCHAR(20) NOT NULL CHECK (test_status IN ('running', 'passed', 'failed')) DEFAULT 'running',
    
    -- Results
    restore_time_seconds INTEGER, -- RTO measurement
    data_integrity_check BOOLEAN, -- Whether data integrity passed
    test_results JSONB DEFAULT '{}'::jsonb,
    
    -- Metadata
    tested_by UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_restore_tests_backup ON backup_restore_tests(backup_id);
CREATE INDEX IF NOT EXISTS idx_backup_restore_tests_status ON backup_restore_tests(test_status);

-- Circuit Breaker States table (Chunk 4)
CREATE TABLE IF NOT EXISTS circuit_breaker_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Circuit breaker details
    service_name VARCHAR(100) NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    
    -- State
    state VARCHAR(20) NOT NULL CHECK (state IN ('closed', 'open', 'half_open')) DEFAULT 'closed',
    
    -- Metrics
    failure_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    last_failure_at TIMESTAMP WITH TIME ZONE,
    last_success_at TIMESTAMP WITH TIME ZONE,
    
    -- Configuration
    failure_threshold INTEGER DEFAULT 5, -- Open circuit after N failures
    success_threshold INTEGER DEFAULT 2, -- Close circuit after N successes
    timeout_seconds INTEGER DEFAULT 60, -- Time to wait before half-open
    
    -- Metadata
    opened_at TIMESTAMP WITH TIME ZONE,
    last_state_change_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(service_name, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_circuit_breaker_states_service ON circuit_breaker_states(service_name);
CREATE INDEX IF NOT EXISTS idx_circuit_breaker_states_state ON circuit_breaker_states(state);

-- Chaos Experiments table (Chunk 4)
CREATE TABLE IF NOT EXISTS chaos_experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Experiment details
    experiment_name VARCHAR(255) NOT NULL,
    experiment_type VARCHAR(50) NOT NULL, -- 'pod_kill', 'latency_injection', 'network_partition', etc.
    target_service VARCHAR(100),
    
    -- Configuration
    experiment_config JSONB NOT NULL, -- Type-specific configuration
    duration_seconds INTEGER,
    
    -- Execution
    scheduled_at TIMESTAMP WITH TIME ZONE,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('scheduled', 'running', 'completed', 'failed', 'cancelled')) DEFAULT 'scheduled',
    
    -- Results
    impact_assessment JSONB DEFAULT '{}'::jsonb,
    recovery_time_seconds INTEGER,
    passed BOOLEAN,
    
    -- Metadata
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chaos_experiments_type ON chaos_experiments(experiment_type);
CREATE INDEX IF NOT EXISTS idx_chaos_experiments_status ON chaos_experiments(status);
CREATE INDEX IF NOT EXISTS idx_chaos_experiments_scheduled ON chaos_experiments(scheduled_at);

-- Data Retention Policies table (Chunk 3)
CREATE TABLE IF NOT EXISTS data_retention_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Policy details
    policy_name VARCHAR(255) NOT NULL UNIQUE,
    table_name VARCHAR(255) NOT NULL,
    retention_days INTEGER NOT NULL, -- Days to retain data
    
    -- Actions
    action_on_expiry VARCHAR(50) NOT NULL CHECK (action_on_expiry IN ('delete', 'archive', 'anonymize')) DEFAULT 'delete',
    archive_location VARCHAR(500), -- For archive action
    
    -- Status
    enabled BOOLEAN DEFAULT true,
    
    -- Metadata
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_retention_policies_table ON data_retention_policies(table_name);
CREATE INDEX IF NOT EXISTS idx_data_retention_policies_enabled ON data_retention_policies(enabled);

-- Data Deletion Log table (Chunk 3)
CREATE TABLE IF NOT EXISTS data_deletion_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Deletion details
    policy_id UUID REFERENCES data_retention_policies(id),
    table_name VARCHAR(255) NOT NULL,
    deletion_type VARCHAR(50) NOT NULL CHECK (deletion_type IN ('retention', 'gdpr', 'manual')) DEFAULT 'retention',
    
    -- Scope
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- Execution
    deleted_count INTEGER DEFAULT 0,
    deleted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Metadata
    executed_by UUID REFERENCES users(id),
    deletion_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_deletion_log_policy ON data_deletion_log(policy_id);
CREATE INDEX IF NOT EXISTS idx_data_deletion_log_tenant ON data_deletion_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_data_deletion_log_deleted_at ON data_deletion_log(deleted_at);

-- Add updated_at triggers
CREATE TRIGGER update_slo_definitions_updated_at BEFORE UPDATE ON slo_definitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_alert_rules_updated_at BEFORE UPDATE ON alert_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_access_requests_updated_at BEFORE UPDATE ON access_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_backup_catalog_updated_at BEFORE UPDATE ON backup_catalog FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_circuit_breaker_states_updated_at BEFORE UPDATE ON circuit_breaker_states FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_chaos_experiments_updated_at BEFORE UPDATE ON chaos_experiments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_data_retention_policies_updated_at BEFORE UPDATE ON data_retention_policies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default SLOs (Chunk 2)
INSERT INTO slo_definitions (slo_name, service_name, metric_name, target_value, window_days, description) VALUES
    ('ocr_median_latency', 'ocr-service', 'ocr_processing_time_seconds', 6.0, 30, 'OCR median processing time should be <6s'),
    ('filing_success_rate', 'filing-service', 'filing_submission_success_rate', 0.995, 30, 'Filing submission success rate should be >99.5%'),
    ('onboarding_completion_time', 'onboarding-service', 'onboarding_completion_time_minutes', 10.0, 30, 'Onboarding completion time should be <10 minutes')
ON CONFLICT (slo_name) DO NOTHING;

-- Insert default system roles (Chunk 3)
INSERT INTO roles (id, role_name, role_type, description) VALUES
    (gen_random_uuid(), 'admin', 'system', 'Full system administrator access'),
    (gen_random_uuid(), 'compliance_admin', 'system', 'Compliance and rulepack administrator'),
    (gen_random_uuid(), 'accountant', 'system', 'Accountant with filing and document access'),
    (gen_random_uuid(), 'reviewer', 'system', 'Document and filing reviewer'),
    (gen_random_uuid(), 'viewer', 'system', 'Read-only access')
ON CONFLICT (role_name) DO NOTHING;
