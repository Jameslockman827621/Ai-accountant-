-- Migration: Add MFA fields to users table

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT;

CREATE INDEX IF NOT EXISTS idx_users_mfa_enabled ON users(mfa_enabled);
