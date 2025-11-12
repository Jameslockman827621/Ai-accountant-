-- Migration: Add scheduled_reports table

CREATE TABLE IF NOT EXISTS scheduled_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    report_type VARCHAR(50) NOT NULL CHECK (report_type IN ('profit_loss', 'balance_sheet', 'cash_flow', 'tax')),
    schedule VARCHAR(20) NOT NULL CHECK (schedule IN ('daily', 'weekly', 'monthly')),
    email VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_sent_at TIMESTAMP WITH TIME ZONE,
    next_send_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_tenant_id ON scheduled_reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_next_send ON scheduled_reports(next_send_at) WHERE is_active = true;
