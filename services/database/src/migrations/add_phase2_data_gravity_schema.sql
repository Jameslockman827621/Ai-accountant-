-- Phase 2: Data Gravity - Comprehensive Database Schema
-- Unified ingestion, classification, reconciliation, and notification infrastructure

-- Unified Ingestion Log - Captures all data ingestion events
CREATE TABLE IF NOT EXISTS ingestion_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Source identification
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('bank_feed', 'payroll', 'commerce', 'email', 'webhook', 'csv', 'manual', 'api')),
    connector_id UUID REFERENCES connector_registry(id) ON DELETE SET NULL,
    connector_provider VARCHAR(100), -- 'plaid', 'truelayer', 'gusto', 'shopify', etc.
    connector_version VARCHAR(50),
    
    -- Payload tracking
    payload_hash VARCHAR(255) NOT NULL, -- SHA-256 hash for deduplication
    payload_size_bytes INTEGER,
    payload_preview JSONB, -- First 1KB of payload for debugging
    full_payload_storage_key VARCHAR(255), -- S3 key for full payload
    
    -- Processing metadata
    processing_status VARCHAR(20) NOT NULL CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed', 'retrying')) DEFAULT 'pending',
    processing_latency_ms INTEGER,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 5,
    
    -- Classification results
    classification_id UUID, -- Reference to classification result
    classification_confidence DECIMAL(5,4),
    classification_model_version VARCHAR(50),
    
    -- Reconciliation results
    reconciliation_status VARCHAR(20) CHECK (reconciliation_status IN ('unmatched', 'matched', 'partial', 'exception')),
    reconciliation_id UUID, -- Reference to reconciliation record
    
    -- Error handling
    error_message TEXT,
    error_code VARCHAR(50),
    error_stack TEXT,
    exception_queue_id UUID, -- If routed to exception queue
    
    -- Timing
    ingested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    failed_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit
    created_by UUID REFERENCES users(id),
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_log_tenant ON ingestion_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_log_source_type ON ingestion_log(source_type);
CREATE INDEX IF NOT EXISTS idx_ingestion_log_connector ON ingestion_log(connector_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_log_payload_hash ON ingestion_log(payload_hash);
CREATE INDEX IF NOT EXISTS idx_ingestion_log_status ON ingestion_log(processing_status);
CREATE INDEX IF NOT EXISTS idx_ingestion_log_ingested_at ON ingestion_log(ingested_at);
CREATE INDEX IF NOT EXISTS idx_ingestion_log_processing_status ON ingestion_log(processing_status, ingested_at);

-- Feature Store - For ML models (vendor embeddings, pattern fingerprints)
CREATE TABLE IF NOT EXISTS feature_store (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Feature identification
    feature_type VARCHAR(50) NOT NULL CHECK (feature_type IN ('vendor_embedding', 'pattern_fingerprint', 'tax_code_mapping', 'gl_code_suggestion', 'anomaly_threshold')),
    feature_key VARCHAR(255) NOT NULL, -- e.g., vendor name, pattern hash
    
    -- Feature data
    feature_vector JSONB, -- Embedding vector or feature data
    feature_metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Model versioning
    model_version VARCHAR(50),
    model_training_date TIMESTAMP WITH TIME ZONE,
    
    -- Usage tracking
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP WITH TIME ZONE,
    accuracy_score DECIMAL(5,4), -- For validation
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    confidence_threshold DECIMAL(5,4), -- Minimum confidence for use
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(tenant_id, feature_type, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_feature_store_tenant ON feature_store(tenant_id);
CREATE INDEX IF NOT EXISTS idx_feature_store_type ON feature_store(feature_type);
CREATE INDEX IF NOT EXISTS idx_feature_store_key ON feature_store(feature_key);
CREATE INDEX IF NOT EXISTS idx_feature_store_active ON feature_store(is_active);

-- Exception Queue - For items requiring manual review
CREATE TABLE IF NOT EXISTS exception_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Exception details
    exception_type VARCHAR(50) NOT NULL CHECK (exception_type IN ('low_confidence', 'validation_error', 'reconciliation_failure', 'anomaly_detected', 'duplicate_suspected', 'manual_review')),
    severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
    
    -- Source reference
    ingestion_log_id UUID REFERENCES ingestion_log(id) ON DELETE SET NULL,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    transaction_id UUID, -- Reference to bank transaction or ledger entry
    reconciliation_id UUID, -- Reference to reconciliation record
    
    -- Exception data
    exception_data JSONB NOT NULL, -- Full context of the exception
    error_message TEXT,
    suggested_action TEXT,
    
    -- Status
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'claimed', 'resolved', 'dismissed')) DEFAULT 'pending',
    claimed_by UUID REFERENCES users(id),
    claimed_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    resolution_action VARCHAR(50), -- 'approved', 'rejected', 'corrected', 'dismissed'
    
    -- Visibility timeout (for manual claim)
    visibility_timeout TIMESTAMP WITH TIME ZONE,
    
    -- Priority and SLA
    priority INTEGER DEFAULT 0, -- Higher = more urgent
    sla_deadline TIMESTAMP WITH TIME ZONE,
    sla_breached BOOLEAN DEFAULT false,
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exception_queue_tenant ON exception_queue(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exception_queue_type ON exception_queue(exception_type);
CREATE INDEX IF NOT EXISTS idx_exception_queue_status ON exception_queue(status);
CREATE INDEX IF NOT EXISTS idx_exception_queue_severity ON exception_queue(severity);
CREATE INDEX IF NOT EXISTS idx_exception_queue_priority ON exception_queue(priority DESC);
CREATE INDEX IF NOT EXISTS idx_exception_queue_sla ON exception_queue(sla_deadline);
CREATE INDEX IF NOT EXISTS idx_exception_queue_claimed ON exception_queue(claimed_by, status);

-- Connector Sync Schedule - For managing periodic syncs
CREATE TABLE IF NOT EXISTS connector_sync_schedule (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    connector_id UUID NOT NULL REFERENCES connector_registry(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Schedule configuration
    sync_frequency VARCHAR(20) NOT NULL CHECK (sync_frequency IN ('realtime', 'hourly', 'daily', 'weekly', 'custom')),
    sync_interval_minutes INTEGER, -- For custom frequency
    sync_window_start TIME, -- Time of day to start sync window
    sync_window_end TIME,
    
    -- Sync status
    last_sync_at TIMESTAMP WITH TIME ZONE,
    last_sync_status VARCHAR(20) CHECK (last_sync_status IN ('success', 'partial', 'failed')),
    last_sync_error TEXT,
    next_sync_at TIMESTAMP WITH TIME ZONE,
    
    -- Historical sync
    historical_sync_enabled BOOLEAN DEFAULT false,
    historical_sync_start_date DATE,
    historical_sync_end_date DATE,
    historical_sync_status VARCHAR(20) CHECK (historical_sync_status IN ('pending', 'in_progress', 'completed', 'failed')),
    historical_sync_progress DECIMAL(5,2) DEFAULT 0, -- 0-100%
    
    -- Sync metrics
    total_syncs INTEGER DEFAULT 0,
    successful_syncs INTEGER DEFAULT 0,
    failed_syncs INTEGER DEFAULT 0,
    avg_sync_duration_ms INTEGER,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    paused_until TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_schedule_connector ON connector_sync_schedule(connector_id);
CREATE INDEX IF NOT EXISTS idx_sync_schedule_tenant ON connector_sync_schedule(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_schedule_next_sync ON connector_sync_schedule(next_sync_at);
CREATE INDEX IF NOT EXISTS idx_sync_schedule_active ON connector_sync_schedule(is_active, next_sync_at);

-- Vendor Enrichment Cache - For vendor data lookup
CREATE TABLE IF NOT EXISTS vendor_enrichment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Vendor identification
    vendor_name VARCHAR(255) NOT NULL,
    vendor_name_normalized VARCHAR(255), -- Normalized for matching
    vendor_domain VARCHAR(255),
    vendor_email VARCHAR(255),
    
    -- Enrichment data
    vat_number VARCHAR(100),
    vat_registration_country VARCHAR(2),
    tax_id VARCHAR(100), -- W-9, W-8, CRA BN, etc.
    tax_id_type VARCHAR(50), -- 'ein', 'ssn', 'bn', etc.
    tax_id_country VARCHAR(2),
    
    -- Business details
    business_type VARCHAR(50),
    industry VARCHAR(100),
    address JSONB,
    phone VARCHAR(50),
    
    -- Verification status
    verification_status VARCHAR(20) CHECK (verification_status IN ('unverified', 'verified', 'failed', 'pending')) DEFAULT 'unverified',
    verification_source VARCHAR(50), -- 'hmrc', 'irs', 'cra', 'manual', 'api'
    verification_date TIMESTAMP WITH TIME ZONE,
    
    -- Usage tracking
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP WITH TIME ZONE,
    
    -- Confidence and quality
    confidence_score DECIMAL(5,4),
    data_quality_score DECIMAL(5,4),
    
    -- Metadata
    enrichment_source VARCHAR(50), -- 'api', 'manual', 'classification', 'user_input'
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(tenant_id, vendor_name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_vendor_enrichment_tenant ON vendor_enrichment(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendor_enrichment_name ON vendor_enrichment(vendor_name);
CREATE INDEX IF NOT EXISTS idx_vendor_enrichment_normalized ON vendor_enrichment(vendor_name_normalized);
CREATE INDEX IF NOT EXISTS idx_vendor_enrichment_domain ON vendor_enrichment(vendor_domain);
CREATE INDEX IF NOT EXISTS idx_vendor_enrichment_vat ON vendor_enrichment(vat_number);

-- Classification Results - Detailed classification output
CREATE TABLE IF NOT EXISTS classification_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    ingestion_log_id UUID REFERENCES ingestion_log(id) ON DELETE SET NULL,
    
    -- Classification output
    document_type VARCHAR(50) NOT NULL,
    confidence_score DECIMAL(5,4) NOT NULL,
    model_version VARCHAR(50),
    model_type VARCHAR(50), -- 'transformer', 'deterministic', 'hybrid'
    
    -- Extracted fields with confidence
    extracted_fields JSONB NOT NULL, -- {field: {value, confidence, source}}
    field_confidence_scores JSONB, -- Per-field confidence breakdown
    
    -- Entity extraction
    vendor_name VARCHAR(255),
    vendor_confidence DECIMAL(5,4),
    customer_name VARCHAR(255),
    customer_confidence DECIMAL(5,4),
    
    -- Tax fields
    tax_amount DECIMAL(15,2),
    tax_rate DECIMAL(5,4),
    tax_type VARCHAR(50), -- 'vat', 'sales_tax', 'gst', etc.
    tax_country VARCHAR(2),
    
    -- Line items
    line_items JSONB, -- Array of line item objects
    total_amount DECIMAL(15,2),
    currency VARCHAR(3),
    
    -- Enrichment
    vendor_enrichment_id UUID REFERENCES vendor_enrichment(id) ON DELETE SET NULL,
    gl_code_suggestion VARCHAR(50),
    gl_code_confidence DECIMAL(5,4),
    compliance_flags JSONB, -- Array of compliance issues
    
    -- Auto-tagging
    tags VARCHAR(100)[] DEFAULT '{}',
    recurring_vendor BOOLEAN DEFAULT false,
    recurring_pattern_id UUID, -- Reference to recurring pattern
    
    -- Quality metrics
    quality_score DECIMAL(5,4),
    completeness_score DECIMAL(5,4), -- How complete is the extraction
    
    -- Review status
    requires_review BOOLEAN DEFAULT false,
    review_reason TEXT,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    
    -- Feedback loop
    human_correction JSONB, -- Captured corrections for active learning
    correction_applied BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_classification_results_tenant ON classification_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_classification_results_document ON classification_results(document_id);
CREATE INDEX IF NOT EXISTS idx_classification_results_ingestion ON classification_results(ingestion_log_id);
CREATE INDEX IF NOT EXISTS idx_classification_results_confidence ON classification_results(confidence_score);
CREATE INDEX IF NOT EXISTS idx_classification_results_review ON classification_results(requires_review);
CREATE INDEX IF NOT EXISTS idx_classification_results_vendor ON classification_results(vendor_name);

-- Reconciliation Matches - Detailed matching results
CREATE TABLE IF NOT EXISTS reconciliation_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Match details
    match_type VARCHAR(50) NOT NULL CHECK (match_type IN ('exact', 'partial', 'fuzzy', 'manual')),
    match_confidence DECIMAL(5,4) NOT NULL,
    match_score DECIMAL(10,4), -- Calculated matching score
    
    -- Matched items
    bank_transaction_id UUID, -- Reference to bank transaction
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    ledger_entry_id UUID, -- Reference to ledger entry
    invoice_id UUID, -- Reference to invoice
    receipt_id UUID, -- Reference to receipt
    
    -- Amount matching
    bank_amount DECIMAL(15,2),
    document_amount DECIMAL(15,2),
    amount_difference DECIMAL(15,2),
    amount_tolerance DECIMAL(15,2), -- Allowed difference
    
    -- Date matching
    bank_date DATE,
    document_date DATE,
    date_difference_days INTEGER,
    date_tolerance_days INTEGER, -- Allowed difference
    
    -- Currency
    currency VARCHAR(3),
    exchange_rate DECIMAL(15,8), -- If multi-currency
    
    -- Matching criteria used
    matching_criteria JSONB, -- Which fields were used for matching
    matching_rules_applied JSONB, -- Which rules were applied
    
    -- Status
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'matched', 'unmatched', 'exception', 'resolved')) DEFAULT 'pending',
    auto_matched BOOLEAN DEFAULT false,
    matched_by UUID REFERENCES users(id), -- If manual match
    matched_at TIMESTAMP WITH TIME ZONE,
    
    -- Exception handling
    exception_id UUID REFERENCES exception_queue(id) ON DELETE SET NULL,
    exception_reason TEXT,
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_tenant ON reconciliation_matches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_type ON reconciliation_matches(match_type);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_status ON reconciliation_matches(status);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_bank_transaction ON reconciliation_matches(bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_document ON reconciliation_matches(document_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_matches_confidence ON reconciliation_matches(match_confidence);

-- Notification Preferences - User notification settings
CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE, -- NULL = tenant-wide default
    
    -- Channel preferences
    email_enabled BOOLEAN DEFAULT true,
    sms_enabled BOOLEAN DEFAULT false,
    in_app_enabled BOOLEAN DEFAULT true,
    push_enabled BOOLEAN DEFAULT false,
    
    -- Notification types
    daily_digest_enabled BOOLEAN DEFAULT true,
    daily_digest_time TIME DEFAULT '09:00:00',
    daily_digest_timezone VARCHAR(50) DEFAULT 'UTC',
    
    critical_alerts_enabled BOOLEAN DEFAULT true,
    reconciliation_alerts_enabled BOOLEAN DEFAULT true,
    exception_alerts_enabled BOOLEAN DEFAULT true,
    connector_health_alerts_enabled BOOLEAN DEFAULT true,
    filing_reminders_enabled BOOLEAN DEFAULT true,
    
    -- Frequency controls
    alert_frequency VARCHAR(20) CHECK (alert_frequency IN ('realtime', 'hourly', 'daily', 'weekly')) DEFAULT 'realtime',
    digest_frequency VARCHAR(20) CHECK (digest_frequency IN ('daily', 'weekly', 'never')) DEFAULT 'daily',
    
    -- Quiet hours
    quiet_hours_enabled BOOLEAN DEFAULT false,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    quiet_hours_timezone VARCHAR(50),
    
    -- Unsubscribe tracking
    unsubscribed_channels VARCHAR(50)[], -- Array of unsubscribed channel types
    unsubscribe_reason TEXT,
    unsubscribed_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_tenant ON notification_preferences(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id);

-- Notification Delivery Log - Track all notifications sent
CREATE TABLE IF NOT EXISTS notification_delivery_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- Notification details
    notification_type VARCHAR(50) NOT NULL,
    notification_category VARCHAR(50), -- 'digest', 'alert', 'reminder', 'system'
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms', 'in_app', 'push')),
    
    -- Content
    subject VARCHAR(255),
    template_id VARCHAR(100),
    template_variables JSONB,
    content_preview TEXT, -- First 200 chars
    
    -- Delivery status
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced', 'opened', 'clicked')) DEFAULT 'pending',
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    
    -- Provider response
    provider_message_id VARCHAR(255), -- External provider message ID
    provider_response JSONB,
    error_message TEXT,
    error_code VARCHAR(50),
    
    -- SLA tracking
    sla_deadline TIMESTAMP WITH TIME ZONE,
    sla_met BOOLEAN,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_delivery_tenant ON notification_delivery_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_user ON notification_delivery_log(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_type ON notification_delivery_log(notification_type);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_status ON notification_delivery_log(status);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_channel ON notification_delivery_log(channel);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_sent_at ON notification_delivery_log(sent_at);

-- Anomaly Detections - For anomaly detection system
CREATE TABLE IF NOT EXISTS anomaly_detections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Anomaly details
    anomaly_type VARCHAR(50) NOT NULL CHECK (anomaly_type IN ('amount_deviation', 'duplicate_invoice', 'suspicious_vendor', 'unusual_pattern', 'missing_document', 'date_anomaly')),
    severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high', 'critical')) DEFAULT 'medium',
    
    -- Source references
    transaction_id UUID,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    ingestion_log_id UUID REFERENCES ingestion_log(id) ON DELETE SET NULL,
    
    -- Anomaly data
    anomaly_score DECIMAL(5,4) NOT NULL, -- 0-1, higher = more anomalous
    baseline_value DECIMAL(15,2), -- Expected value
    actual_value DECIMAL(15,2), -- Actual value
    deviation_percentage DECIMAL(5,2), -- Percentage deviation
    
    -- Detection metadata
    detection_model VARCHAR(50),
    detection_rules JSONB, -- Rules that triggered detection
    detection_context JSONB, -- Additional context
    
    -- Status
    status VARCHAR(20) NOT NULL CHECK (status IN ('detected', 'reviewing', 'resolved', 'false_positive', 'dismissed')) DEFAULT 'detected',
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT,
    
    -- Exception queue link
    exception_id UUID REFERENCES exception_queue(id) ON DELETE SET NULL,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomaly_detections_tenant ON anomaly_detections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_type ON anomaly_detections(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_severity ON anomaly_detections(severity);
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_status ON anomaly_detections(status);
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_score ON anomaly_detections(anomaly_score DESC);

-- Add updated_at triggers
CREATE TRIGGER update_ingestion_log_updated_at BEFORE UPDATE ON ingestion_log FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_feature_store_updated_at BEFORE UPDATE ON feature_store FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_exception_queue_updated_at BEFORE UPDATE ON exception_queue FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_connector_sync_schedule_updated_at BEFORE UPDATE ON connector_sync_schedule FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vendor_enrichment_updated_at BEFORE UPDATE ON vendor_enrichment FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_classification_results_updated_at BEFORE UPDATE ON classification_results FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_reconciliation_matches_updated_at BEFORE UPDATE ON reconciliation_matches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_notification_preferences_updated_at BEFORE UPDATE ON notification_preferences FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_notification_delivery_log_updated_at BEFORE UPDATE ON notification_delivery_log FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_anomaly_detections_updated_at BEFORE UPDATE ON anomaly_detections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
