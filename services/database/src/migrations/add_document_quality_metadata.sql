-- Migration: add document quality metadata fields

ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS quality_score DECIMAL(5, 2),
    ADD COLUMN IF NOT EXISTS quality_issues JSONB,
    ADD COLUMN IF NOT EXISTS upload_checklist JSONB,
    ADD COLUMN IF NOT EXISTS page_count INTEGER,
    ADD COLUMN IF NOT EXISTS upload_source VARCHAR(30),
    ADD COLUMN IF NOT EXISTS upload_notes TEXT,
    ADD COLUMN IF NOT EXISTS suggested_document_type VARCHAR(20) CHECK (suggested_document_type IN ('invoice', 'receipt', 'statement', 'payslip', 'tax_form', 'other'));

UPDATE documents
SET upload_source = COALESCE(upload_source, 'legacy');
