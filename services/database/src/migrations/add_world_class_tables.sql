-- Migration: Add tables for world-class readiness features
-- Run this migration to add all required tables for new features

-- Filing reviews table
CREATE TABLE IF NOT EXISTS filing_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested')),
    comments TEXT,
    changes JSONB,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(filing_id)
);

CREATE INDEX IF NOT EXISTS idx_filing_reviews_filing_id ON filing_reviews(filing_id);
CREATE INDEX IF NOT EXISTS idx_filing_reviews_tenant_id ON filing_reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_filing_reviews_status ON filing_reviews(status);

-- Filing amendments table
CREATE TABLE IF NOT EXISTS filing_amendments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    original_filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    amendment_filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    changes JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'submitted', 'accepted', 'rejected')),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filing_amendments_original ON filing_amendments(original_filing_id);
CREATE INDEX IF NOT EXISTS idx_filing_amendments_tenant ON filing_amendments(tenant_id);

-- Filing submission confirmations table
CREATE TABLE IF NOT EXISTS filing_submission_confirmations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    submission_id VARCHAR(255) NOT NULL,
    confirmation_number VARCHAR(255),
    receipt_url TEXT,
    receipt_storage_key VARCHAR(500),
    receipt_content_type VARCHAR(100),
    response_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(filing_id)
);

CREATE INDEX IF NOT EXISTS idx_filing_confirmations_filing_id ON filing_submission_confirmations(filing_id);
CREATE INDEX IF NOT EXISTS idx_filing_confirmations_tenant_id ON filing_submission_confirmations(tenant_id);

-- Filing rejections table
CREATE TABLE IF NOT EXISTS filing_rejections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    rejection_reason TEXT NOT NULL,
    rejection_code VARCHAR(50),
    rejection_details JSONB,
    rejected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(filing_id)
);

CREATE INDEX IF NOT EXISTS idx_filing_rejections_filing_id ON filing_rejections(filing_id);
CREATE INDEX IF NOT EXISTS idx_filing_rejections_tenant_id ON filing_rejections(tenant_id);

-- Document review queue table
CREATE TABLE IF NOT EXISTS document_review_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'approved', 'rejected')),
    assigned_to UUID REFERENCES users(id),
    review_notes TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, document_id, status) WHERE status = 'pending'
);

CREATE INDEX IF NOT EXISTS idx_review_queue_tenant_id ON document_review_queue(tenant_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_document_id ON document_review_queue(document_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON document_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_priority ON document_review_queue(priority);

-- Bank sync retries table
CREATE TABLE IF NOT EXISTS bank_sync_retries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    connection_id UUID NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_error TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'succeeded', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_retries_connection_id ON bank_sync_retries(connection_id);
CREATE INDEX IF NOT EXISTS idx_sync_retries_tenant_id ON bank_sync_retries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sync_retries_status ON bank_sync_retries(status);
CREATE INDEX IF NOT EXISTS idx_sync_retries_next_retry ON bank_sync_retries(next_retry_at) WHERE status = 'pending';

-- Error retries table
CREATE TABLE IF NOT EXISTS error_retries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    operation_type VARCHAR(50) NOT NULL,
    operation_id VARCHAR(255) NOT NULL,
    error TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    next_retry_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'succeeded', 'failed', 'cancelled')),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_retries_tenant_id ON error_retries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_error_retries_operation ON error_retries(operation_type, operation_id);
CREATE INDEX IF NOT EXISTS idx_error_retries_status ON error_retries(status);
CREATE INDEX IF NOT EXISTS idx_error_retries_next_retry ON error_retries(next_retry_at) WHERE status = 'pending';

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_number VARCHAR(100) NOT NULL UNIQUE,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    amount DECIMAL(19, 4) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'GBP',
    status VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
    line_items JSONB NOT NULL,
    subtotal DECIMAL(19, 4) NOT NULL,
    tax DECIMAL(19, 4) NOT NULL,
    total DECIMAL(19, 4) NOT NULL,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);

-- Payment failures table
CREATE TABLE IF NOT EXISTS payment_failures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    failure_count INTEGER NOT NULL DEFAULT 1,
    last_failure_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    next_retry_at TIMESTAMP WITH TIME ZONE,
    failure_reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'escalated')),
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_failures_tenant_id ON payment_failures(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_failures_invoice_id ON payment_failures(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_failures_status ON payment_failures(status);

-- Subscription cancellations table
CREATE TABLE IF NOT EXISTS subscription_cancellations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    reason TEXT,
    feedback TEXT,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_cancellations_tenant_id ON subscription_cancellations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_cancellations_user_id ON subscription_cancellations(user_id);

-- Support ticket messages table (if not exists)
CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    is_internal BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON support_ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_user_id ON support_ticket_messages(user_id);

-- Knowledge base articles table
CREATE TABLE IF NOT EXISTS knowledge_base_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    views INTEGER NOT NULL DEFAULT 0,
    helpful INTEGER NOT NULL DEFAULT 0,
    not_helpful INTEGER NOT NULL DEFAULT 0,
    is_published BOOLEAN NOT NULL DEFAULT false,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_articles_category ON knowledge_base_articles(category);
CREATE INDEX IF NOT EXISTS idx_kb_articles_published ON knowledge_base_articles(is_published);
CREATE INDEX IF NOT EXISTS idx_kb_articles_views ON knowledge_base_articles(views);

-- Backups table (if not exists as backup_records)
CREATE TABLE IF NOT EXISTS backups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    backup_type VARCHAR(20) NOT NULL CHECK (backup_type IN ('full', 'incremental')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
    size_bytes BIGINT,
    storage_location VARCHAR(500) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backups_tenant_id ON backups(tenant_id);
CREATE INDEX IF NOT EXISTS idx_backups_status ON backups(status);
CREATE INDEX IF NOT EXISTS idx_backups_started_at ON backups(started_at);

-- Data exports table
CREATE TABLE IF NOT EXISTS data_exports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    format VARCHAR(10) NOT NULL CHECK (format IN ('json', 'csv', 'sql')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    download_url TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_exports_tenant_id ON data_exports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_data_exports_status ON data_exports(status);

-- Restore operations table
CREATE TABLE IF NOT EXISTS restore_operations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    backup_id UUID NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
    restore_type VARCHAR(20) NOT NULL CHECK (restore_type IN ('full', 'selective')),
    restore_point TIMESTAMP WITH TIME ZONE NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restore_operations_tenant_id ON restore_operations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_restore_operations_backup_id ON restore_operations(backup_id);
CREATE INDEX IF NOT EXISTS idx_restore_operations_status ON restore_operations(status);

-- Onboarding steps table (if not exists)
CREATE TABLE IF NOT EXISTS onboarding_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    step_name VARCHAR(50) NOT NULL,
    step_data JSONB,
    completed BOOLEAN NOT NULL DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, step_name)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_steps_tenant_id ON onboarding_steps(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_steps_completed ON onboarding_steps(completed);

-- Onboarding events table (if not exists)
CREATE TABLE IF NOT EXISTS onboarding_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    step_name VARCHAR(50),
    event_type VARCHAR(50) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_tenant_id ON onboarding_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_user_id ON onboarding_events(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_event_type ON onboarding_events(event_type);

-- Transactions table (for double-entry grouping)
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id),
    description TEXT NOT NULL,
    transaction_date DATE NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_tenant_id ON transactions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_document_id ON transactions(document_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);

-- Add updated_at triggers for new tables
CREATE TRIGGER update_filing_reviews_updated_at BEFORE UPDATE ON filing_reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_filing_amendments_updated_at BEFORE UPDATE ON filing_amendments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_filing_confirmations_updated_at BEFORE UPDATE ON filing_submission_confirmations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_filing_rejections_updated_at BEFORE UPDATE ON filing_rejections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_review_queue_updated_at BEFORE UPDATE ON document_review_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sync_retries_updated_at BEFORE UPDATE ON bank_sync_retries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_error_retries_updated_at BEFORE UPDATE ON error_retries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_failures_updated_at BEFORE UPDATE ON payment_failures
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_backups_updated_at BEFORE UPDATE ON backups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_data_exports_updated_at BEFORE UPDATE ON data_exports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_restore_operations_updated_at BEFORE UPDATE ON restore_operations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_onboarding_steps_updated_at BEFORE UPDATE ON onboarding_steps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_kb_articles_updated_at BEFORE UPDATE ON knowledge_base_articles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
