-- Migration: Add tables for World-Class Document Digestion
-- This migration adds tables for omnichannel intake, OCR, classification, and review

-- Email Aliases table (Chunk 1)
CREATE TABLE IF NOT EXISTS email_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Alias details
    alias_slug VARCHAR(100) NOT NULL, -- Random slug for email address
    alias_email VARCHAR(255) NOT NULL, -- Full email address (e.g., tenant-abc123@domain.com)
    secret_token VARCHAR(255) NOT NULL, -- Secret for webhook validation
    
    -- Configuration
    enabled BOOLEAN DEFAULT true,
    auto_classify BOOLEAN DEFAULT true, -- Auto-classify documents from this alias
    routing_rules JSONB DEFAULT '{}'::jsonb, -- Custom routing rules
    
    -- Expiration
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(tenant_id, alias_slug),
    UNIQUE(alias_email)
);

CREATE INDEX IF NOT EXISTS idx_email_aliases_tenant ON email_aliases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_aliases_email ON email_aliases(alias_email);
CREATE INDEX IF NOT EXISTS idx_email_aliases_enabled ON email_aliases(enabled);
CREATE INDEX IF NOT EXISTS idx_email_aliases_expires ON email_aliases(expires_at);

-- Ingestion Rules table (Chunk 1)
CREATE TABLE IF NOT EXISTS ingestion_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Rule configuration
    rule_name VARCHAR(255) NOT NULL,
    rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN ('routing', 'classification', 'validation', 'notification')),
    priority INTEGER DEFAULT 0, -- Higher priority rules evaluated first
    
    -- Conditions
    source_type VARCHAR(50), -- 'email', 'webhook', 'csv', 'api', 'mobile'
    source_pattern VARCHAR(255), -- Pattern to match (e.g., email domain, webhook provider)
    conditions JSONB DEFAULT '{}'::jsonb, -- Additional conditions (e.g., file type, size)
    
    -- Actions
    actions JSONB NOT NULL DEFAULT '{}'::jsonb, -- Actions to take (e.g., bypass_classification, route_to_review)
    target_classification VARCHAR(50), -- Force classification to this type
    target_workflow VARCHAR(100), -- Route to specific workflow
    
    -- Status
    enabled BOOLEAN DEFAULT true,
    
    -- Metadata
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_rules_tenant ON ingestion_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_rules_type ON ingestion_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_ingestion_rules_enabled ON ingestion_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_ingestion_rules_priority ON ingestion_rules(priority DESC);

-- Document Extractions table (Chunk 2)
CREATE TABLE IF NOT EXISTS document_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Extraction details
    extraction_provider VARCHAR(50) NOT NULL, -- 'google_document_ai', 'aws_textract', 'paddleocr', 'tesseract'
    extraction_model VARCHAR(100), -- Model version used
    language VARCHAR(10), -- Detected language (ISO 639-1)
    
    -- Structured output
    tokens JSONB DEFAULT '[]'::jsonb, -- Array of {text: string, bbox: {x, y, width, height}, confidence: number}
    bounding_boxes JSONB DEFAULT '[]'::jsonb, -- Array of bounding box coordinates
    layout_structure JSONB DEFAULT '{}'::jsonb, -- Document structure (pages, blocks, paragraphs)
    
    -- Text extraction
    raw_text TEXT, -- Full extracted text
    structured_text JSONB DEFAULT '{}'::jsonb, -- Structured text by sections
    
    -- Metadata
    processing_time_ms INTEGER,
    page_count INTEGER,
    confidence_scores JSONB DEFAULT '{}'::jsonb, -- Confidence scores per page/region
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(document_id)
);

CREATE INDEX IF NOT EXISTS idx_document_extractions_document ON document_extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_document_extractions_provider ON document_extractions(extraction_provider);
CREATE INDEX IF NOT EXISTS idx_document_extractions_language ON document_extractions(language);

-- OCR Usage Metrics table (Chunk 2)
CREATE TABLE IF NOT EXISTS ocr_usage_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    extraction_id UUID REFERENCES document_extractions(id) ON DELETE SET NULL,
    
    -- Provider details
    provider VARCHAR(50) NOT NULL,
    model VARCHAR(100),
    
    -- Cost tracking
    api_calls INTEGER DEFAULT 1,
    tokens_used INTEGER, -- For token-based pricing
    pages_processed INTEGER DEFAULT 1,
    cost_usd DECIMAL(10, 4), -- Cost in USD
    
    -- Performance
    processing_time_ms INTEGER,
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_usage_metrics_tenant ON ocr_usage_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ocr_usage_metrics_document ON ocr_usage_metrics(document_id);
CREATE INDEX IF NOT EXISTS idx_ocr_usage_metrics_provider ON ocr_usage_metrics(provider);
CREATE INDEX IF NOT EXISTS idx_ocr_usage_metrics_created ON ocr_usage_metrics(created_at);

-- Document Line Items table (Chunk 3)
CREATE TABLE IF NOT EXISTS document_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Line item details
    line_number INTEGER NOT NULL,
    description TEXT,
    quantity DECIMAL(10, 2),
    unit_price DECIMAL(10, 2),
    total_amount DECIMAL(10, 2),
    tax_amount DECIMAL(10, 2),
    tax_rate DECIMAL(5, 2),
    
    -- Classification
    account_code VARCHAR(50), -- Suggested chart of accounts code
    category VARCHAR(100), -- Expense/revenue category
    vendor_name VARCHAR(255), -- Extracted vendor name
    
    -- Confidence
    confidence_score DECIMAL(5, 4), -- Confidence in extraction accuracy
    
    -- Metadata
    raw_text TEXT, -- Original text from document
    bounding_box JSONB, -- Position in document
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_line_items_document ON document_line_items(document_id);
CREATE INDEX IF NOT EXISTS idx_document_line_items_line_number ON document_line_items(document_id, line_number);
CREATE INDEX IF NOT EXISTS idx_document_line_items_vendor ON document_line_items(vendor_name);

-- Document Entities table (Chunk 3)
CREATE TABLE IF NOT EXISTS document_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Entity details
    entity_type VARCHAR(50) NOT NULL, -- 'vendor', 'customer', 'amount', 'date', 'tax_id', 'invoice_number', etc.
    entity_value TEXT NOT NULL,
    confidence_score DECIMAL(5, 4),
    
    -- Position
    bounding_box JSONB, -- Position in document
    page_number INTEGER,
    
    -- Normalization
    normalized_value TEXT, -- Normalized/standardized value
    validation_status VARCHAR(20) CHECK (validation_status IN ('pending', 'valid', 'invalid', 'warning')) DEFAULT 'pending',
    validation_errors JSONB DEFAULT '[]'::jsonb,
    
    -- Metadata
    extraction_method VARCHAR(50), -- How it was extracted (ocr, ml, rule)
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_entities_document ON document_entities(document_id);
CREATE INDEX IF NOT EXISTS idx_document_entities_type ON document_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_document_entities_validation ON document_entities(validation_status);

-- Extraction Confidence table (Chunk 3)
CREATE TABLE IF NOT EXISTS extraction_confidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    
    -- Confidence scores
    overall_confidence DECIMAL(5, 4) NOT NULL, -- Overall extraction confidence
    classification_confidence DECIMAL(5, 4), -- Classification confidence
    ocr_confidence DECIMAL(5, 4), -- OCR confidence
    entity_extraction_confidence DECIMAL(5, 4), -- Entity extraction confidence
    
    -- Field-level confidence
    field_confidence JSONB DEFAULT '{}'::jsonb, -- {field_name: confidence_score}
    
    -- Flags
    low_confidence_fields TEXT[], -- Array of field names with low confidence
    requires_review BOOLEAN DEFAULT false,
    
    -- Metadata
    calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(document_id)
);

CREATE INDEX IF NOT EXISTS idx_extraction_confidence_document ON extraction_confidence(document_id);
CREATE INDEX IF NOT EXISTS idx_extraction_confidence_overall ON extraction_confidence(overall_confidence);
CREATE INDEX IF NOT EXISTS idx_extraction_confidence_review ON extraction_confidence(requires_review);

-- Guidance Recipes table (Chunk 4)
CREATE TABLE IF NOT EXISTS guidance_recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Recipe details
    recipe_code VARCHAR(100) NOT NULL UNIQUE, -- e.g., 'photo_too_blurry', 'low_confidence', 'missing_fields'
    recipe_name VARCHAR(255) NOT NULL,
    recipe_description TEXT,
    
    -- Conditions
    trigger_conditions JSONB NOT NULL DEFAULT '{}'::jsonb, -- Conditions that trigger this guidance
    
    -- Guidance content
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    suggested_actions JSONB DEFAULT '[]'::jsonb, -- Array of actionable steps
    help_url VARCHAR(500), -- Link to help documentation
    
    -- Priority
    priority INTEGER DEFAULT 0,
    enabled BOOLEAN DEFAULT true,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guidance_recipes_code ON guidance_recipes(recipe_code);
CREATE INDEX IF NOT EXISTS idx_guidance_recipes_enabled ON guidance_recipes(enabled);

-- Document Guidance table (Chunk 4) - Links guidance recipes to documents
CREATE TABLE IF NOT EXISTS document_guidance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    recipe_id UUID NOT NULL REFERENCES guidance_recipes(id) ON DELETE CASCADE,
    
    -- Status
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_at TIMESTAMP WITH TIME ZONE,
    acknowledged_by UUID REFERENCES users(id),
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    UNIQUE(document_id, recipe_id)
);

CREATE INDEX IF NOT EXISTS idx_document_guidance_document ON document_guidance(document_id);
CREATE INDEX IF NOT EXISTS idx_document_guidance_recipe ON document_guidance(recipe_id);
CREATE INDEX IF NOT EXISTS idx_document_guidance_acknowledged ON document_guidance(acknowledged);

-- Review Assignments table (Chunk 4)
CREATE TABLE IF NOT EXISTS review_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Assignment details
    assigned_to UUID NOT NULL REFERENCES users(id),
    assigned_by UUID REFERENCES users(id),
    assignment_reason TEXT, -- Why this document was assigned
    
    -- SLA tracking
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    due_at TIMESTAMP WITH TIME ZONE, -- SLA deadline
    completed_at TIMESTAMP WITH TIME ZONE,
    overdue BOOLEAN DEFAULT false,
    
    -- Status
    status VARCHAR(20) CHECK (status IN ('assigned', 'in_progress', 'completed', 'escalated')) DEFAULT 'assigned',
    priority VARCHAR(20) CHECK (priority IN ('low', 'normal', 'high', 'urgent')) DEFAULT 'normal',
    
    -- Escalation
    escalated_at TIMESTAMP WITH TIME ZONE,
    escalated_to UUID REFERENCES users(id),
    escalation_reason TEXT,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_review_assignments_document ON review_assignments(document_id);
CREATE INDEX IF NOT EXISTS idx_review_assignments_tenant ON review_assignments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_review_assignments_assigned_to ON review_assignments(assigned_to);
CREATE INDEX IF NOT EXISTS idx_review_assignments_status ON review_assignments(status);
CREATE INDEX IF NOT EXISTS idx_review_assignments_due ON review_assignments(due_at);
CREATE INDEX IF NOT EXISTS idx_review_assignments_overdue ON review_assignments(overdue);

-- Add preferred_languages to tenants (Chunk 2)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS preferred_languages VARCHAR(10)[] DEFAULT ARRAY['en']::VARCHAR(10)[];

-- Add updated_at triggers
CREATE TRIGGER update_email_aliases_updated_at BEFORE UPDATE ON email_aliases FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ingestion_rules_updated_at BEFORE UPDATE ON ingestion_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_document_extractions_updated_at BEFORE UPDATE ON document_extractions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_document_line_items_updated_at BEFORE UPDATE ON document_line_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_document_entities_updated_at BEFORE UPDATE ON document_entities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_extraction_confidence_updated_at BEFORE UPDATE ON extraction_confidence FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_guidance_recipes_updated_at BEFORE UPDATE ON guidance_recipes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_review_assignments_updated_at BEFORE UPDATE ON review_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default guidance recipes (Chunk 4)
INSERT INTO guidance_recipes (recipe_code, recipe_name, recipe_description, trigger_conditions, title, message, suggested_actions, priority) VALUES
    ('photo_too_blurry', 'Photo Too Blurry', 'Document image quality is too low', '{"quality_score": {"$lt": 0.7}}', 'Image Quality Issue', 'The uploaded document image is too blurry or low quality. Please upload a clearer image.', ARRAY['Retake photo with better lighting', 'Ensure document is flat and in focus', 'Use scanner instead of camera'], 10),
    ('low_confidence', 'Low Extraction Confidence', 'OCR or classification confidence is below threshold', '{"confidence_score": {"$lt": 0.8}}', 'Low Confidence Extraction', 'Some fields could not be extracted with high confidence. Please review and correct.', ARRAY['Review extracted data', 'Manually correct low-confidence fields', 'Upload higher quality document'], 8),
    ('missing_fields', 'Missing Required Fields', 'Required fields are missing from extraction', '{"missing_required_fields": {"$exists": true}}', 'Missing Information', 'Some required fields are missing from this document. Please provide the missing information.', ARRAY['Check if information exists in document', 'Manually enter missing fields', 'Contact vendor for complete document'], 9),
    ('duplicate_detected', 'Duplicate Document', 'A similar document already exists', '{"duplicate_score": {"$gt": 0.9}}', 'Possible Duplicate', 'This document appears to be a duplicate of an existing document.', ARRAY['Review duplicate documents', 'Merge if duplicate', 'Archive if not needed'], 7)
ON CONFLICT (recipe_code) DO NOTHING;
