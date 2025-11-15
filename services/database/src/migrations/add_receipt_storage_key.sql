-- Migration: Enhance filing receipts with storage metadata

ALTER TABLE filing_receipts
    ADD COLUMN IF NOT EXISTS storage_key TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS filing_receipts_storage_key_idx ON filing_receipts(storage_key);
