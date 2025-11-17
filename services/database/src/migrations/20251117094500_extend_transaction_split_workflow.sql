-- Migration: extend transaction split workflow metadata

BEGIN;

ALTER TABLE bank_transactions
    ADD COLUMN IF NOT EXISTS split_submitted_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS split_submitted_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS split_review_notes TEXT;

ALTER TABLE transaction_splits
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS review_notes TEXT;

COMMIT;
