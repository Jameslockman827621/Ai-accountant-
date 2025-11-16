-- Bulk operations tables
CREATE TABLE IF NOT EXISTS bulk_operations (
    id VARCHAR(255) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    total_items INTEGER NOT NULL DEFAULT 0,
    processed_items INTEGER NOT NULL DEFAULT 0,
    successful_items INTEGER NOT NULL DEFAULT 0,
    failed_items INTEGER NOT NULL DEFAULT 0,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX idx_bulk_operations_tenant ON bulk_operations(tenant_id);
CREATE INDEX idx_bulk_operations_status ON bulk_operations(status);

CREATE TABLE IF NOT EXISTS bulk_operation_items (
    id VARCHAR(255) PRIMARY KEY,
    operation_id VARCHAR(255) NOT NULL,
    item_id VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (operation_id) REFERENCES bulk_operations(id) ON DELETE CASCADE,
    UNIQUE(operation_id, item_id)
);

CREATE INDEX idx_bulk_operation_items_operation ON bulk_operation_items(operation_id);
CREATE INDEX idx_bulk_operation_items_status ON bulk_operation_items(status);

-- Benchmark data table
CREATE TABLE IF NOT EXISTS benchmark_data (
    id SERIAL PRIMARY KEY,
    industry VARCHAR(100) NOT NULL,
    metric VARCHAR(100) NOT NULL,
    period VARCHAR(20) NOT NULL,
    value DECIMAL(15, 4) NOT NULL,
    percentile_25 DECIMAL(15, 4),
    percentile_50 DECIMAL(15, 4),
    percentile_75 DECIMAL(15, 4),
    percentile_90 DECIMAL(15, 4),
    source VARCHAR(100) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(industry, metric, period)
);

CREATE INDEX idx_benchmark_industry ON benchmark_data(industry);
CREATE INDEX idx_benchmark_metric ON benchmark_data(metric);

-- Webhook events table
CREATE TABLE IF NOT EXISTS webhook_events (
    id VARCHAR(255) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    event_type VARCHAR(100),
    payload JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_webhook_events_tenant ON webhook_events(tenant_id);
CREATE INDEX idx_webhook_events_provider ON webhook_events(provider);
CREATE INDEX idx_webhook_events_created ON webhook_events(created_at);

-- Contacts table (for Xero sync)
CREATE TABLE IF NOT EXISTS contacts (
    id VARCHAR(255) PRIMARY KEY,
    tenant_id VARCHAR(255) NOT NULL,
    external_id VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    type VARCHAR(50),
    source VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, external_id, source)
);

CREATE INDEX idx_contacts_tenant ON contacts(tenant_id);
CREATE INDEX idx_contacts_source ON contacts(source);
