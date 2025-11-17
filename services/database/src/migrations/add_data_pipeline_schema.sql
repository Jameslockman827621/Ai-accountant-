-- Data Pipeline and Datasets Schema
-- Migration: add_data_pipeline_schema.sql
-- Description: Tables for ingestion events, data lake, warehouse, and golden datasets

-- Ingestion Events table (normalized from all channels)
CREATE TABLE IF NOT EXISTS ingestion_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('dashboard', 'mobile', 'email', 'webhook', 'csv', 'bank_feed', 'api')),
    source_type VARCHAR(50) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    payload_preview JSONB,
    full_payload_storage_key VARCHAR(500),
    trace_id VARCHAR(100),
    sla_received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    sla_processed_at TIMESTAMP WITH TIME ZONE,
    sla_completed_at TIMESTAMP WITH TIME ZONE,
    sla_target_seconds INTEGER DEFAULT 300, -- 5 minutes default
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'duplicate')),
    error_message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, checksum)
);

CREATE INDEX idx_ingestion_events_tenant_id ON ingestion_events(tenant_id);
CREATE INDEX idx_ingestion_events_channel ON ingestion_events(channel);
CREATE INDEX idx_ingestion_events_status ON ingestion_events(status);
CREATE INDEX idx_ingestion_events_trace_id ON ingestion_events(trace_id);
CREATE INDEX idx_ingestion_events_sla_received ON ingestion_events(sla_received_at);
CREATE INDEX idx_ingestion_events_checksum ON ingestion_events(checksum);

-- Email Dropboxes table
CREATE TABLE IF NOT EXISTS email_dropboxes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email_address VARCHAR(255) NOT NULL,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('imap', 'ses')),
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, email_address)
);

CREATE INDEX idx_email_dropboxes_tenant_id ON email_dropboxes(tenant_id);
CREATE INDEX idx_email_dropboxes_active ON email_dropboxes(is_active) WHERE is_active = true;

-- Tenant API Keys for webhook authentication
CREATE TABLE IF NOT EXISTS tenant_api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_name VARCHAR(255) NOT NULL,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    rate_limit_per_minute INTEGER DEFAULT 100,
    rate_limit_per_hour INTEGER DEFAULT 1000,
    is_active BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, key_name)
);

CREATE INDEX idx_tenant_api_keys_tenant_id ON tenant_api_keys(tenant_id);
CREATE INDEX idx_tenant_api_keys_hash ON tenant_api_keys(key_hash);
CREATE INDEX idx_tenant_api_keys_active ON tenant_api_keys(is_active) WHERE is_active = true;

-- Rate Limiting Logs
CREATE TABLE IF NOT EXISTS rate_limit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES tenant_api_keys(id),
    endpoint VARCHAR(255) NOT NULL,
    ip_address INET,
    request_count INTEGER NOT NULL DEFAULT 1,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL,
    window_end TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rate_limit_logs_tenant_id ON rate_limit_logs(tenant_id);
CREATE INDEX idx_rate_limit_logs_api_key ON rate_limit_logs(api_key_id);
CREATE INDEX idx_rate_limit_logs_window ON rate_limit_logs(window_start, window_end);

-- Data Lake Storage Registry
CREATE TABLE IF NOT EXISTS data_lake_storage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    storage_type VARCHAR(50) NOT NULL CHECK (storage_type IN ('raw', 'parsed', 'structured', 'ledger', 'filing')),
    storage_key VARCHAR(500) NOT NULL,
    version VARCHAR(20) NOT NULL DEFAULT 'v1',
    file_size_bytes BIGINT NOT NULL,
    content_type VARCHAR(100),
    checksum VARCHAR(64),
    encryption_key_id VARCHAR(255),
    ingested_from UUID REFERENCES ingestion_events(id),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, storage_key, version)
);

CREATE INDEX idx_data_lake_storage_tenant_id ON data_lake_storage(tenant_id);
CREATE INDEX idx_data_lake_storage_type ON data_lake_storage(storage_type);
CREATE INDEX idx_data_lake_storage_key ON data_lake_storage(storage_key);
CREATE INDEX idx_data_lake_storage_ingested_from ON data_lake_storage(ingested_from);

-- Warehouse Schemas Registry
CREATE TABLE IF NOT EXISTS warehouse_schemas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schema_name VARCHAR(100) NOT NULL UNIQUE,
    schema_version VARCHAR(20) NOT NULL,
    schema_type VARCHAR(50) NOT NULL CHECK (schema_type IN ('avro', 'json', 'parquet')),
    schema_definition JSONB NOT NULL,
    backward_compatible BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_warehouse_schemas_name_version ON warehouse_schemas(schema_name, schema_version);

-- Warehouse Data Snapshots
CREATE TABLE IF NOT EXISTS warehouse_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    schema_id UUID NOT NULL REFERENCES warehouse_schemas(id),
    snapshot_date DATE NOT NULL,
    record_count BIGINT NOT NULL DEFAULT 0,
    storage_location VARCHAR(500),
    checksum VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, schema_id, snapshot_date)
);

CREATE INDEX idx_warehouse_snapshots_tenant_id ON warehouse_snapshots(tenant_id);
CREATE INDEX idx_warehouse_snapshots_schema ON warehouse_snapshots(schema_id);
CREATE INDEX idx_warehouse_snapshots_date ON warehouse_snapshots(snapshot_date);

-- Golden Dataset Labels
CREATE TABLE IF NOT EXISTS golden_labels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id),
    ledger_entry_id UUID REFERENCES ledger_entries(id),
    label_type VARCHAR(50) NOT NULL CHECK (label_type IN ('field_validation', 'ledger_posting', 'anomaly_tag', 'category_tag')),
    field_name VARCHAR(100),
    original_value JSONB,
    corrected_value JSONB,
    confidence_score DECIMAL(5, 4),
    is_anomaly BOOLEAN NOT NULL DEFAULT false,
    anomaly_reason TEXT,
    expected_ledger_posting JSONB,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_golden_labels_tenant_id ON golden_labels(tenant_id);
CREATE INDEX idx_golden_labels_document_id ON golden_labels(document_id);
CREATE INDEX idx_golden_labels_label_type ON golden_labels(label_type);
CREATE INDEX idx_golden_labels_anomaly ON golden_labels(is_anomaly) WHERE is_anomaly = true;

-- Golden Dataset Versions
CREATE TABLE IF NOT EXISTS golden_dataset_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dataset_name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL, -- e.g., v2024.01.patch
    semantic_version VARCHAR(50),
    label_count INTEGER NOT NULL DEFAULT 0,
    sample_count INTEGER NOT NULL DEFAULT 0,
    coverage_by_category JSONB NOT NULL DEFAULT '{}'::jsonb,
    storage_location VARCHAR(500),
    storage_format VARCHAR(50) CHECK (storage_format IN ('delta_lake', 'parquet', 'json')),
    checksum VARCHAR(64),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(dataset_name, version)
);

CREATE INDEX idx_golden_dataset_versions_name ON golden_dataset_versions(dataset_name);
CREATE INDEX idx_golden_dataset_versions_version ON golden_dataset_versions(version);

-- Golden Dataset Samples (for sampling strategy)
CREATE TABLE IF NOT EXISTS golden_dataset_samples (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    dataset_version_id UUID REFERENCES golden_dataset_versions(id),
    document_id UUID REFERENCES documents(id),
    sampling_strategy VARCHAR(50) NOT NULL CHECK (sampling_strategy IN ('random', 'stratified', 'confidence_based', 'vendor_based', 'category_based')),
    vendor_name VARCHAR(255),
    category VARCHAR(100),
    confidence_score DECIMAL(5, 4),
    priority INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_review', 'labeled', 'skipped')),
    assigned_to UUID REFERENCES users(id),
    assigned_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_golden_dataset_samples_tenant_id ON golden_dataset_samples(tenant_id);
CREATE INDEX idx_golden_dataset_samples_version ON golden_dataset_samples(dataset_version_id);
CREATE INDEX idx_golden_dataset_samples_status ON golden_dataset_samples(status);
CREATE INDEX idx_golden_dataset_samples_strategy ON golden_dataset_samples(sampling_strategy);
CREATE INDEX idx_golden_dataset_samples_vendor ON golden_dataset_samples(vendor_name);
CREATE INDEX idx_golden_dataset_samples_category ON golden_dataset_samples(category);

-- Bank Sync Audit (enhanced)
CREATE TABLE IF NOT EXISTS bank_sync_audit (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    connection_id UUID NOT NULL,
    provider VARCHAR(50) NOT NULL,
    sync_type VARCHAR(50) NOT NULL CHECK (sync_type IN ('full', 'differential', 'incremental')),
    sync_status VARCHAR(20) NOT NULL CHECK (sync_status IN ('started', 'completed', 'failed', 'partial')),
    transaction_count INTEGER NOT NULL DEFAULT 0,
    new_transactions INTEGER NOT NULL DEFAULT 0,
    updated_transactions INTEGER NOT NULL DEFAULT 0,
    latency_seconds DECIMAL(10, 3),
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bank_sync_audit_tenant_id ON bank_sync_audit(tenant_id);
CREATE INDEX idx_bank_sync_audit_connection_id ON bank_sync_audit(connection_id);
CREATE INDEX idx_bank_sync_audit_status ON bank_sync_audit(sync_status);
CREATE INDEX idx_bank_sync_audit_created_at ON bank_sync_audit(created_at);

-- Row Level Security
ALTER TABLE ingestion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_lake_storage ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_schemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE golden_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE golden_dataset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE golden_dataset_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_sync_audit ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY tenant_isolation_ingestion_events ON ingestion_events
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_tenant_api_keys ON tenant_api_keys
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_rate_limit_logs ON rate_limit_logs
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_data_lake_storage ON data_lake_storage
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_warehouse_snapshots ON warehouse_snapshots
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_golden_labels ON golden_labels
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_golden_dataset_samples ON golden_dataset_samples
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_bank_sync_audit ON bank_sync_audit
    FOR ALL USING (true);

-- Triggers for updated_at
CREATE TRIGGER update_ingestion_events_updated_at BEFORE UPDATE ON ingestion_events
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenant_api_keys_updated_at BEFORE UPDATE ON tenant_api_keys
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_warehouse_schemas_updated_at BEFORE UPDATE ON warehouse_schemas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_golden_labels_updated_at BEFORE UPDATE ON golden_labels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_golden_dataset_samples_updated_at BEFORE UPDATE ON golden_dataset_samples
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
