-- Migration: Add advanced feature tables

-- Classification corrections and metrics
CREATE TABLE IF NOT EXISTS classification_corrections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    original_type VARCHAR(50) NOT NULL,
    correct_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classification_metrics (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_type VARCHAR(50) NOT NULL,
    correct_count INTEGER NOT NULL DEFAULT 0,
    incorrect_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, document_type)
);

-- Expense categorizations
CREATE TABLE IF NOT EXISTS expense_categorizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    vendor VARCHAR(255),
    category VARCHAR(50) NOT NULL,
    sub_category VARCHAR(100),
    confidence DECIMAL(5, 4) NOT NULL,
    tax_deductible BOOLEAN NOT NULL DEFAULT true,
    vat_recoverable BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categorization_corrections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    expense_id UUID REFERENCES expense_categorizations(id) ON DELETE CASCADE,
    original_category VARCHAR(50) NOT NULL,
    correct_category VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categorization_metrics (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category_code VARCHAR(50) NOT NULL,
    correct_count INTEGER NOT NULL DEFAULT 0,
    incorrect_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, category_code)
);

-- Immutable audit logs
CREATE TABLE IF NOT EXISTS immutable_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID NOT NULL,
    changes_before JSONB NOT NULL,
    changes_after JSONB NOT NULL,
    metadata JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    hash VARCHAR(64) NOT NULL UNIQUE,
    previous_hash VARCHAR(64) REFERENCES immutable_audit_logs(hash)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_classification_corrections_tenant_id ON classification_corrections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_classification_corrections_document_id ON classification_corrections(document_id);
CREATE INDEX IF NOT EXISTS idx_expense_categorizations_tenant_id ON expense_categorizations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expense_categorizations_category ON expense_categorizations(category);
CREATE INDEX IF NOT EXISTS idx_categorization_corrections_tenant_id ON categorization_corrections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_immutable_audit_logs_tenant_id ON immutable_audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_immutable_audit_logs_resource ON immutable_audit_logs(tenant_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_immutable_audit_logs_timestamp ON immutable_audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_immutable_audit_logs_hash ON immutable_audit_logs(hash);
CREATE INDEX IF NOT EXISTS idx_immutable_audit_logs_previous_hash ON immutable_audit_logs(previous_hash);
