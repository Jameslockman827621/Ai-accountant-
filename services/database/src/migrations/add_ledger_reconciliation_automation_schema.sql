-- Ledger and Reconciliation Automation Schema
-- Migration: add_ledger_reconciliation_automation_schema.sql
-- Description: Intelligent matching, period close, multi-entity, anomaly detection

-- Reconciliation Events (full audit trail)
CREATE TABLE IF NOT EXISTS reconciliation_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    bank_transaction_id UUID REFERENCES bank_transactions(id),
    document_id UUID REFERENCES documents(id),
    ledger_entry_id UUID REFERENCES ledger_entries(id),
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('match', 'unmatch', 'auto_match', 'manual_match', 'split', 'merge', 'exception_created', 'exception_resolved')),
    reason_code VARCHAR(100) NOT NULL,
    reason_description TEXT,
    confidence_score DECIMAL(5, 4),
    match_signals JSONB NOT NULL DEFAULT '{}'::jsonb, -- amount, date, vendor, ocr_confidence scores
    performed_by UUID REFERENCES users(id),
    performed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_reconciliation_events_tenant_id ON reconciliation_events(tenant_id);
CREATE INDEX idx_reconciliation_events_bank_transaction ON reconciliation_events(bank_transaction_id);
CREATE INDEX idx_reconciliation_events_document ON reconciliation_events(document_id);
CREATE INDEX idx_reconciliation_events_ledger_entry ON reconciliation_events(ledger_entry_id);
CREATE INDEX idx_reconciliation_events_type ON reconciliation_events(event_type);
CREATE INDEX idx_reconciliation_events_performed_at ON reconciliation_events(performed_at);

-- Matching Thresholds (per-tenant ML-learned thresholds)
CREATE TABLE IF NOT EXISTS matching_thresholds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    threshold_type VARCHAR(50) NOT NULL CHECK (threshold_type IN ('auto_match', 'suggest_match', 'manual_review')),
    min_confidence_score DECIMAL(5, 4) NOT NULL,
    signal_weights JSONB NOT NULL DEFAULT '{}'::jsonb, -- Weights for amount, date, vendor, ocr_confidence
    learned_from_samples INTEGER NOT NULL DEFAULT 0,
    last_updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, threshold_type)
);

CREATE INDEX idx_matching_thresholds_tenant_id ON matching_thresholds(tenant_id);
CREATE INDEX idx_matching_thresholds_type ON matching_thresholds(threshold_type);

-- Period Close
CREATE TABLE IF NOT EXISTS period_close (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entity_id UUID, -- For multi-entity support
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    close_status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (close_status IN ('draft', 'in_progress', 'locked', 'closed', 'reopened')),
    locked_at TIMESTAMP WITH TIME ZONE,
    locked_by UUID REFERENCES users(id),
    closed_at TIMESTAMP WITH TIME ZONE,
    closed_by UUID REFERENCES users(id),
    checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
    validation_results JSONB NOT NULL DEFAULT '{}'::jsonb,
    variance_alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
    required_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    generated_reports JSONB NOT NULL DEFAULT '[]'::jsonb,
    export_package_location VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, entity_id, period_start, period_end)
);

CREATE INDEX idx_period_close_tenant_id ON period_close(tenant_id);
CREATE INDEX idx_period_close_entity_id ON period_close(entity_id);
CREATE INDEX idx_period_close_status ON period_close(close_status);
CREATE INDEX idx_period_close_period ON period_close(period_start, period_end);

-- Period Close Tasks
CREATE TABLE IF NOT EXISTS period_close_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_close_id UUID NOT NULL REFERENCES period_close(id) ON DELETE CASCADE,
    task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('accrual', 'depreciation', 'prepayment', 'reconciliation', 'validation', 'report', 'tax', 'filing', 'approval')),
    task_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'blocked', 'skipped')),
    assigned_to UUID REFERENCES users(id),
    due_date TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    blocker_reason TEXT,
    result_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_period_close_tasks_period_close ON period_close_tasks(period_close_id);
CREATE INDEX idx_period_close_tasks_status ON period_close_tasks(status);
CREATE INDEX idx_period_close_tasks_assigned_to ON period_close_tasks(assigned_to);
CREATE INDEX idx_period_close_tasks_type ON period_close_tasks(task_type);

-- Multi-Entity Support
CREATE TABLE IF NOT EXISTS entities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    parent_entity_id UUID REFERENCES entities(id),
    entity_name VARCHAR(255) NOT NULL,
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('parent', 'subsidiary', 'division', 'department')),
    currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
    country_code VARCHAR(2),
    tax_id VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_entities_tenant_id ON entities(tenant_id);
CREATE INDEX idx_entities_parent ON entities(parent_entity_id);
CREATE INDEX idx_entities_active ON entities(is_active) WHERE is_active = true;

-- Intercompany Transactions
CREATE TABLE IF NOT EXISTS intercompany_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    from_entity_id UUID NOT NULL REFERENCES entities(id),
    to_entity_id UUID NOT NULL REFERENCES entities(id),
    transaction_date DATE NOT NULL,
    amount DECIMAL(19, 4) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    description TEXT NOT NULL,
    ledger_entry_id UUID REFERENCES ledger_entries(id),
    eliminated BOOLEAN NOT NULL DEFAULT false,
    eliminated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_intercompany_transactions_tenant_id ON intercompany_transactions(tenant_id);
CREATE INDEX idx_intercompany_transactions_from_entity ON intercompany_transactions(from_entity_id);
CREATE INDEX idx_intercompany_transactions_to_entity ON intercompany_transactions(to_entity_id);
CREATE INDEX idx_intercompany_transactions_eliminated ON intercompany_transactions(eliminated) WHERE eliminated = false;

-- FX Rates & Remeasurement
CREATE TABLE IF NOT EXISTS exchange_rates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    from_currency VARCHAR(3) NOT NULL,
    to_currency VARCHAR(3) NOT NULL,
    rate_date DATE NOT NULL,
    rate DECIMAL(15, 6) NOT NULL,
    rate_type VARCHAR(20) NOT NULL CHECK (rate_type IN ('spot', 'average', 'historical')),
    source VARCHAR(50), -- e.g., 'ECB', 'custom', 'manual'
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, from_currency, to_currency, rate_date, rate_type)
);

CREATE INDEX idx_exchange_rates_tenant_id ON exchange_rates(tenant_id);
CREATE INDEX idx_exchange_rates_currencies ON exchange_rates(from_currency, to_currency);
CREATE INDEX idx_exchange_rates_date ON exchange_rates(rate_date);

-- FX Remeasurement Log
CREATE TABLE IF NOT EXISTS fx_remeasurement_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entity_id UUID NOT NULL REFERENCES entities(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    from_currency VARCHAR(3) NOT NULL,
    to_currency VARCHAR(3) NOT NULL,
    remeasurement_date DATE NOT NULL,
    account_code VARCHAR(50) NOT NULL,
    original_amount DECIMAL(19, 4) NOT NULL,
    remeasured_amount DECIMAL(19, 4) NOT NULL,
    exchange_rate DECIMAL(15, 6) NOT NULL,
    fx_gain_loss DECIMAL(19, 4),
    ledger_entry_id UUID REFERENCES ledger_entries(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fx_remeasurement_log_tenant_id ON fx_remeasurement_log(tenant_id);
CREATE INDEX idx_fx_remeasurement_log_entity_id ON fx_remeasurement_log(entity_id);
CREATE INDEX idx_fx_remeasurement_log_period ON fx_remeasurement_log(period_start, period_end);

-- Reconciliation Exceptions (enhanced)
CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    exception_type VARCHAR(50) NOT NULL CHECK (exception_type IN ('unmatched', 'duplicate', 'missing_document', 'amount_mismatch', 'date_mismatch', 'unusual_spend', 'anomaly')),
    severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    bank_transaction_id UUID REFERENCES bank_transactions(id),
    document_id UUID REFERENCES documents(id),
    ledger_entry_id UUID REFERENCES ledger_entries(id),
    description TEXT NOT NULL,
    anomaly_score DECIMAL(5, 4), -- ML anomaly detection score
    remediation_playbook JSONB, -- Suggested remediation steps
    assigned_to UUID REFERENCES users(id),
    status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'dismissed')),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id),
    resolution_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reconciliation_exceptions_tenant_id ON reconciliation_exceptions(tenant_id);
CREATE INDEX idx_reconciliation_exceptions_type ON reconciliation_exceptions(exception_type);
CREATE INDEX idx_reconciliation_exceptions_severity ON reconciliation_exceptions(severity);
CREATE INDEX idx_reconciliation_exceptions_status ON reconciliation_exceptions(status);
CREATE INDEX idx_reconciliation_exceptions_assigned_to ON reconciliation_exceptions(assigned_to);
CREATE INDEX idx_reconciliation_exceptions_anomaly_score ON reconciliation_exceptions(anomaly_score) WHERE anomaly_score IS NOT NULL;

-- Consolidated Reports Cache
CREATE TABLE IF NOT EXISTS consolidated_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    report_type VARCHAR(50) NOT NULL CHECK (report_type IN ('profit_loss', 'balance_sheet', 'cash_flow', 'trial_balance')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    entity_ids UUID[] NOT NULL, -- Entities included in consolidation
    base_currency VARCHAR(3) NOT NULL,
    report_data JSONB NOT NULL,
    exchange_rates_used JSONB NOT NULL DEFAULT '{}'::jsonb,
    eliminations_applied JSONB NOT NULL DEFAULT '[]'::jsonb,
    generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    generated_by UUID REFERENCES users(id),
    UNIQUE(tenant_id, report_type, period_start, period_end, entity_ids)
);

CREATE INDEX idx_consolidated_reports_tenant_id ON consolidated_reports(tenant_id);
CREATE INDEX idx_consolidated_reports_type ON consolidated_reports(report_type);
CREATE INDEX idx_consolidated_reports_period ON consolidated_reports(period_start, period_end);

-- Variance Alerts
CREATE TABLE IF NOT EXISTS variance_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_close_id UUID REFERENCES period_close(id),
    alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('balance_drift', 'budget_variance', 'threshold_breach', 'missing_attachment', 'unreconciled_items')),
    account_code VARCHAR(50),
    threshold_amount DECIMAL(19, 4),
    actual_amount DECIMAL(19, 4),
    variance_amount DECIMAL(19, 4),
    variance_percentage DECIMAL(5, 2),
    severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(50) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    acknowledged_by UUID REFERENCES users(id),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_variance_alerts_tenant_id ON variance_alerts(tenant_id);
CREATE INDEX idx_variance_alerts_period_close ON variance_alerts(period_close_id);
CREATE INDEX idx_variance_alerts_type ON variance_alerts(alert_type);
CREATE INDEX idx_variance_alerts_status ON variance_alerts(status);
CREATE INDEX idx_variance_alerts_severity ON variance_alerts(severity);

-- Row Level Security
ALTER TABLE reconciliation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE matching_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_close ENABLE ROW LEVEL SECURITY;
ALTER TABLE period_close_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE intercompany_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_remeasurement_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE consolidated_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE variance_alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY tenant_isolation_reconciliation_events ON reconciliation_events
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_matching_thresholds ON matching_thresholds
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_period_close ON period_close
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_period_close_tasks ON period_close_tasks
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_entities ON entities
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_intercompany_transactions ON intercompany_transactions
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_exchange_rates ON exchange_rates
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_fx_remeasurement_log ON fx_remeasurement_log
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_reconciliation_exceptions ON reconciliation_exceptions
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_consolidated_reports ON consolidated_reports
    FOR ALL USING (true);

CREATE POLICY tenant_isolation_variance_alerts ON variance_alerts
    FOR ALL USING (true);

-- Triggers for updated_at
CREATE TRIGGER update_period_close_updated_at BEFORE UPDATE ON period_close
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_period_close_tasks_updated_at BEFORE UPDATE ON period_close_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_entities_updated_at BEFORE UPDATE ON entities
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reconciliation_exceptions_updated_at BEFORE UPDATE ON reconciliation_exceptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_variance_alerts_updated_at BEFORE UPDATE ON variance_alerts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
