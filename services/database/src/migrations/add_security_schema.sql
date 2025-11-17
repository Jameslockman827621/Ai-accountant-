-- Security and Compliance Schema
-- Adds tables for backups, restore logs, and security events

-- Backup logs table
CREATE TABLE IF NOT EXISTS backup_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_id VARCHAR(255) NOT NULL UNIQUE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    location TEXT NOT NULL,
    size_bytes BIGINT,
    status VARCHAR(50) NOT NULL CHECK (status IN ('completed', 'failed', 'deleted')),
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_tenant ON backup_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_backup_logs_status ON backup_logs(status);
CREATE INDEX IF NOT EXISTS idx_backup_logs_created ON backup_logs(created_at);

-- Restore logs table
CREATE TABLE IF NOT EXISTS restore_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_id VARCHAR(255) NOT NULL,
    target_database VARCHAR(255),
    status VARCHAR(50) NOT NULL CHECK (status IN ('completed', 'failed')),
    error_message TEXT,
    restored_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restore_logs_backup ON restore_logs(backup_id);
CREATE INDEX IF NOT EXISTS idx_restore_logs_status ON restore_logs(status);

-- Security events table
CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    description TEXT,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_tenant ON security_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id);
CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at);

-- HTTP metrics table (for monitoring)
CREATE TABLE IF NOT EXISTS http_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    method VARCHAR(10) NOT NULL,
    path VARCHAR(500) NOT NULL,
    status_code INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_http_metrics_timestamp ON http_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_http_metrics_tenant ON http_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_http_metrics_status ON http_metrics(status_code);

-- Extraction metrics table
CREATE TABLE IF NOT EXISTS extraction_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    accuracy_score DECIMAL(5, 4),
    latency_ms INTEGER,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extraction_metrics_timestamp ON extraction_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_extraction_metrics_tenant ON extraction_metrics(tenant_id);

-- Reconciliation metrics table
CREATE TABLE IF NOT EXISTS reconciliation_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    account_code VARCHAR(50),
    sla_score DECIMAL(5, 4),
    latency_ms INTEGER,
    matched_count INTEGER,
    unmatched_count INTEGER,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_metrics_timestamp ON reconciliation_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_reconciliation_metrics_tenant ON reconciliation_metrics(tenant_id);
