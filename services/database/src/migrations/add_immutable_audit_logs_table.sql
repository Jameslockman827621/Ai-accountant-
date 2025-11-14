-- Migration: Add immutable audit logs table

CREATE TABLE IF NOT EXISTS immutable_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID NOT NULL,
    changes JSONB NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ip_address VARCHAR(45),
    user_agent TEXT,
    hash VARCHAR(64) NOT NULL,
    previous_hash VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_immutable_audit_logs_tenant_id ON immutable_audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_immutable_audit_logs_user_id ON immutable_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_immutable_audit_logs_resource ON immutable_audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_immutable_audit_logs_timestamp ON immutable_audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_immutable_audit_logs_hash ON immutable_audit_logs(hash);

-- Prevent updates and deletes (immutable)
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Immutable audit logs cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER immutable_audit_logs_no_update
    BEFORE UPDATE ON immutable_audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();

CREATE TRIGGER immutable_audit_logs_no_delete
    BEFORE DELETE ON immutable_audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modification();
