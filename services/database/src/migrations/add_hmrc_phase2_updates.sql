-- Migration: Phase 2 HMRC compliance updates

-- Encrypted token storage and metadata for HMRC connections
ALTER TABLE hmrc_connections
    ADD COLUMN IF NOT EXISTS access_token_encrypted JSONB,
    ADD COLUMN IF NOT EXISTS refresh_token_encrypted JSONB,
    ADD COLUMN IF NOT EXISTS refresh_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS vrn TEXT,
    ADD COLUMN IF NOT EXISTS last_connected_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS consent_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_hmrc_connections_status ON hmrc_connections(connection_status);

-- Filing submission audit trail
CREATE TABLE IF NOT EXISTS filing_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    submission_type VARCHAR(20) NOT NULL CHECK (submission_type IN ('initial', 'amendment', 'resubmission')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    submission_id TEXT,
    vrn TEXT,
    period_key TEXT,
    receipt_id TEXT,
    payload JSONB,
    hmrc_response JSONB,
    error TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    submitted_by UUID REFERENCES users(id),
    parent_submission_id UUID REFERENCES filing_submissions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_filing_submissions_filing ON filing_submissions(filing_id);
CREATE INDEX IF NOT EXISTS idx_filing_submissions_tenant ON filing_submissions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_filing_submissions_type ON filing_submissions(submission_type);

-- Link filings and receipts to submission records
ALTER TABLE filings
    ADD COLUMN IF NOT EXISTS last_submission_id UUID REFERENCES filing_submissions(id),
    ADD COLUMN IF NOT EXISTS amendment_of UUID REFERENCES filings(id);

ALTER TABLE filings
    DROP CONSTRAINT IF EXISTS filings_status_check,
    ADD CONSTRAINT filings_status_check CHECK (
        status IN ('draft', 'pending_approval', 'submitted', 'accepted', 'rejected', 'error')
    );

ALTER TABLE filing_receipts
    ADD COLUMN IF NOT EXISTS submission_record_id UUID REFERENCES filing_submissions(id);

CREATE INDEX IF NOT EXISTS filing_receipts_submission_idx ON filing_receipts(submission_record_id);
