-- Migration: Add multi-currency support tables

-- Add columns to ledger_entries for multi-currency
ALTER TABLE ledger_entries
ADD COLUMN IF NOT EXISTS base_amount DECIMAL(15, 2),
ADD COLUMN IF NOT EXISTS base_currency VARCHAR(3) DEFAULT 'GBP',
ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(15, 6) DEFAULT 1.0;

-- Exchange rates table
CREATE TABLE IF NOT EXISTS exchange_rates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_currency VARCHAR(3) NOT NULL,
    to_currency VARCHAR(3) NOT NULL,
    rate DECIMAL(15, 6) NOT NULL,
    rate_date DATE NOT NULL,
    source VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(from_currency, to_currency, rate_date)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup ON exchange_rates(from_currency, to_currency, rate_date);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_date ON exchange_rates(rate_date);

-- Add base currency to tenants metadata if not exists
UPDATE tenants
SET metadata = jsonb_set(
    COALESCE(metadata, '{}'::jsonb),
    '{baseCurrency}',
    '"GBP"'
)
WHERE metadata->>'baseCurrency' IS NULL;
