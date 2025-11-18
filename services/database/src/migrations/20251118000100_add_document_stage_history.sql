-- Migration: Document stage history and processing stage column

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS processing_stage VARCHAR(32) DEFAULT 'document';

UPDATE documents
SET processing_stage = CASE status
  WHEN 'uploaded' THEN 'document'
  WHEN 'processing' THEN 'ocr'
  WHEN 'extracted' THEN 'classification'
  WHEN 'classified' THEN 'ledger_posting'
  WHEN 'posted' THEN 'completed'
  WHEN 'error' THEN 'error'
  ELSE 'document'
END
WHERE processing_stage IS NULL;

CREATE TABLE IF NOT EXISTS document_stage_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_status VARCHAR(20),
  to_status VARCHAR(20) NOT NULL,
  from_stage VARCHAR(32),
  to_stage VARCHAR(32) NOT NULL,
  trigger VARCHAR(64) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_stage_history_document ON document_stage_history(document_id);
CREATE INDEX IF NOT EXISTS idx_document_stage_history_tenant ON document_stage_history(tenant_id);
