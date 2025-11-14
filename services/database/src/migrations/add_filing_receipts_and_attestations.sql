-- Create table for storing HMRC receipts
CREATE TABLE IF NOT EXISTS filing_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL,
  payload JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS filing_receipts_filing_idx ON filing_receipts (filing_id);
CREATE INDEX IF NOT EXISTS filing_receipts_tenant_idx ON filing_receipts (tenant_id);

-- Create table for filing attestations
CREATE TABLE IF NOT EXISTS filing_attestations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  attested_by UUID NOT NULL REFERENCES users(id),
  attested_by_name TEXT NOT NULL,
  attested_by_role TEXT,
  statement TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS filing_attestations_unique_filing ON filing_attestations (filing_id);

-- Event table for scheduled reminders and automation hooks
CREATE TABLE IF NOT EXISTS filing_deadline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS filing_deadline_events_unique ON filing_deadline_events (filing_id, event_type);
