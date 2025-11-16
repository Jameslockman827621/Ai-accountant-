-- Migration: Bring bank_connections table in line with new secure schema

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'bank_connections'
      AND column_name = 'access_token_encrypted'
  ) THEN
    ALTER TABLE bank_connections
      ADD COLUMN access_token_encrypted JSONB,
      ADD COLUMN refresh_token_encrypted JSONB,
      ADD COLUMN webhook_secret_encrypted JSONB,
      ADD COLUMN token_expires_at TIMESTAMPTZ,
      ADD COLUMN last_refreshed_at TIMESTAMPTZ,
      ADD COLUMN last_sync TIMESTAMPTZ,
      ADD COLUMN last_success TIMESTAMPTZ,
      ADD COLUMN last_error TEXT,
      ADD COLUMN provider_account_id TEXT,
      ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN exception_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN error_count INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

ALTER TABLE bank_connections
  ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN metadata DROP NOT NULL,
  ALTER COLUMN metadata SET NOT NULL;

-- Ensure legacy plaintext tokens are cleared
ALTER TABLE bank_connections
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_bank_connections_tenant_provider_account
  ON bank_connections(tenant_id, provider, COALESCE(provider_account_id, item_id));

CREATE INDEX IF NOT EXISTS idx_bank_connections_token_expiry
  ON bank_connections(provider, token_expires_at)
  WHERE token_expires_at IS NOT NULL;
