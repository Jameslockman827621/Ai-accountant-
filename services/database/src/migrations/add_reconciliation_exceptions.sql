-- Migration: Reconciliation exception queue

CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    bank_transaction_id UUID NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    reason TEXT,
    details JSONB,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved')),
    resolution TEXT,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, bank_transaction_id, status) WHERE status <> 'resolved'
);

CREATE INDEX IF NOT EXISTS idx_recon_exceptions_tenant_status
    ON reconciliation_exceptions(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_recon_exceptions_transaction
    ON reconciliation_exceptions(bank_transaction_id);
