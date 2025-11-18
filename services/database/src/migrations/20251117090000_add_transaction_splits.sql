-- Migration: add transaction splits support for bank reconciliations
-- Adds split metadata columns on bank_transactions and creates transaction_splits table

BEGIN;

ALTER TABLE bank_transactions
    ADD COLUMN IF NOT EXISTS is_split BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS split_remaining_amount DECIMAL(19, 4),
    ADD COLUMN IF NOT EXISTS split_status VARCHAR(20) NOT NULL DEFAULT 'not_split'
        CHECK (split_status IN ('not_split', 'draft', 'balanced', 'pending_review', 'applied')),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

UPDATE bank_transactions
SET split_status = 'not_split'
WHERE split_status IS NULL;

CREATE TABLE IF NOT EXISTS transaction_splits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    bank_transaction_id UUID NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending_review', 'applied', 'void')),
    split_amount DECIMAL(19, 4) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    document_id UUID REFERENCES documents(id),
    ledger_entry_id UUID REFERENCES ledger_entries(id),
    memo TEXT,
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    confidence_score DECIMAL(5, 4),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_splits_tenant_tx ON transaction_splits(tenant_id, bank_transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_splits_status ON transaction_splits(status);
CREATE INDEX IF NOT EXISTS idx_transaction_splits_document ON transaction_splits(document_id);
CREATE INDEX IF NOT EXISTS idx_transaction_splits_ledger ON transaction_splits(ledger_entry_id);

ALTER TABLE transaction_splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_transaction_splits ON transaction_splits
    FOR ALL USING (true);

CREATE TRIGGER update_transaction_splits_updated_at BEFORE UPDATE ON transaction_splits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bank_transactions_updated_at BEFORE UPDATE ON bank_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
