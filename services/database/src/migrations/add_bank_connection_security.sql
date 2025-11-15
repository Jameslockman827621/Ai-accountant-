-- Migration: Enhance bank connection security and token metadata

ALTER TABLE bank_connections
    ADD COLUMN IF NOT EXISTS access_token_encrypted JSONB,
    ADD COLUMN IF NOT EXISTS refresh_token_encrypted JSONB,
    ADD COLUMN IF NOT EXISTS webhook_secret_encrypted JSONB,
    ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_refreshed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS provider_account_id TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB,
    ADD COLUMN IF NOT EXISTS exception_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_bank_connections_provider_account
    ON bank_connections(provider, COALESCE(provider_account_id, item_id));

CREATE INDEX IF NOT EXISTS idx_bank_connections_token_expiry
    ON bank_connections(provider, token_expires_at)
    WHERE token_expires_at IS NOT NULL;

-- Existing plaintext tokens will need to be re-linked; clear legacy values
UPDATE bank_connections
SET access_token = NULL,
    refresh_token_encrypted = NULL;
