-- Phase 1: Clarity Onboarding - Comprehensive Database Schema
-- This migration creates all tables required for world-class onboarding experience

-- Organizations/Firms table (extends tenant concept for accounting firms)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('firm', 'client', 'standalone')),
    parent_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    country VARCHAR(2) NOT NULL,
    tax_id VARCHAR(100),
    vat_number VARCHAR(100),
    registration_number VARCHAR(100),
    address JSONB,
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_organizations_parent ON organizations(parent_organization_id);
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(type);
CREATE INDEX IF NOT EXISTS idx_organizations_country ON organizations(country);

-- Link tenants to organizations
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_organization ON tenants(organization_id);

-- Organization invitations table
CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'accountant', 'staff', 'auditor', 'viewer')),
    invited_by UUID NOT NULL REFERENCES users(id),
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    accepted_at TIMESTAMP WITH TIME ZONE,
    accepted_by UUID REFERENCES users(id),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON organization_invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON organization_invitations(email);
CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON organization_invitations(token);
CREATE INDEX IF NOT EXISTS idx_org_invitations_expires ON organization_invitations(expires_at);

-- Intent Profile Schema - Core tenant intent and configuration
CREATE TABLE IF NOT EXISTS intent_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
    
    -- Entity metadata
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('sole_trader', 'partnership', 'limited_company', 'llp', 'llc', 'corporation', 'nonprofit')),
    business_name VARCHAR(255) NOT NULL,
    industry VARCHAR(100),
    employees_count INTEGER,
    annual_revenue_range VARCHAR(50),
    
    -- Jurisdictions and registrations
    primary_jurisdiction VARCHAR(2) NOT NULL,
    additional_jurisdictions VARCHAR(2)[] DEFAULT '{}',
    vat_number VARCHAR(100),
    sales_tax_registrations JSONB DEFAULT '[]'::jsonb, -- Array of {state: string, registration_number: string}
    tax_authority_registrations JSONB DEFAULT '[]'::jsonb, -- Array of {authority: string, registration_number: string, country: string}
    
    -- Fiscal calendar
    fiscal_year_start_month INTEGER CHECK (fiscal_year_start_month >= 1 AND fiscal_year_start_month <= 12),
    fiscal_year_end_month INTEGER CHECK (fiscal_year_end_month >= 1 AND fiscal_year_end_month <= 12),
    accounting_method VARCHAR(20) CHECK (accounting_method IN ('cash', 'accrual', 'hybrid')),
    
    -- Tax obligations
    tax_obligations VARCHAR(50)[] DEFAULT '{}',
    vat_registered BOOLEAN DEFAULT false,
    payroll_enabled BOOLEAN DEFAULT false,
    filing_frequency VARCHAR(20) CHECK (filing_frequency IN ('monthly', 'quarterly', 'annually', 'custom')),
    
    -- Connected systems
    connected_systems JSONB DEFAULT '[]'::jsonb, -- Array of {type: string, provider: string, connected_at: timestamp}
    
    -- Goals and preferences
    primary_goals VARCHAR(100)[] DEFAULT '{}',
    risk_tolerance VARCHAR(20) CHECK (risk_tolerance IN ('conservative', 'moderate', 'aggressive')),
    automation_preferences JSONB DEFAULT '{}'::jsonb,
    
    -- AI context
    business_description TEXT,
    key_contacts JSONB DEFAULT '[]'::jsonb,
    special_requirements TEXT,
    
    -- Status
    profile_completeness INTEGER DEFAULT 0 CHECK (profile_completeness >= 0 AND profile_completeness <= 100),
    verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMP WITH TIME ZONE,
    verified_by UUID REFERENCES users(id),
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_intent_profiles_tenant ON intent_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_intent_profiles_jurisdiction ON intent_profiles(primary_jurisdiction);
CREATE INDEX IF NOT EXISTS idx_intent_profiles_entity_type ON intent_profiles(entity_type);
CREATE INDEX IF NOT EXISTS idx_intent_profiles_verified ON intent_profiles(verified);

-- Consent Ledger - Records of all authorizations and consents
CREATE TABLE IF NOT EXISTS consent_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Consent details
    consent_type VARCHAR(100) NOT NULL, -- 'banking', 'tax_authority', 'data_sharing', 'marketing', 'gdpr', 'ccpa'
    consent_scope VARCHAR(255), -- Specific scope of consent (e.g., 'plaid_accounts', 'hmrc_vat_submissions')
    provider VARCHAR(100), -- Third-party provider if applicable
    consent_status VARCHAR(20) NOT NULL CHECK (consent_status IN ('granted', 'revoked', 'expired', 'pending')) DEFAULT 'pending',
    
    -- Consent metadata
    consent_text TEXT, -- Full text of what was consented to
    ip_address INET,
    user_agent TEXT,
    consent_method VARCHAR(50), -- 'web_form', 'api', 'oauth', 'email_link'
    
    -- Expiry and renewal
    granted_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_reason TEXT,
    
    -- Legal compliance
    gdpr_basis VARCHAR(50), -- 'consent', 'contract', 'legal_obligation', etc.
    ccpa_opt_out BOOLEAN DEFAULT false,
    data_usage_statement TEXT,
    
    -- Audit
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_ledger_tenant ON consent_ledger(tenant_id);
CREATE INDEX IF NOT EXISTS idx_consent_ledger_user ON consent_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_consent_ledger_type ON consent_ledger(consent_type);
CREATE INDEX IF NOT EXISTS idx_consent_ledger_status ON consent_ledger(consent_status);
CREATE INDEX IF NOT EXISTS idx_consent_ledger_expires ON consent_ledger(expires_at);

-- Connector Registry - Tracks required vs enabled connectors
CREATE TABLE IF NOT EXISTS connector_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Connector identification
    connector_type VARCHAR(50) NOT NULL, -- 'bank', 'tax_authority', 'accounting_software', 'ecommerce', 'payment_processor'
    provider VARCHAR(100) NOT NULL, -- 'plaid', 'truelayer', 'hmrc', 'irs', 'cra', 'shopify', 'stripe'
    connector_name VARCHAR(255) NOT NULL, -- Human-readable name
    
    -- Status
    status VARCHAR(20) NOT NULL CHECK (status IN ('required', 'enabled', 'disabled', 'pending', 'error', 'expired')) DEFAULT 'pending',
    is_required BOOLEAN DEFAULT false,
    is_enabled BOOLEAN DEFAULT false,
    
    -- Connection details
    connection_id VARCHAR(255), -- External connection ID from provider
    account_ids VARCHAR(255)[], -- Array of connected account IDs
    connection_metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Credentials and tokens (encrypted references)
    credential_store_key VARCHAR(255), -- Reference to encrypted credential in secure store
    token_refresh_required BOOLEAN DEFAULT false,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Health and monitoring
    last_sync_at TIMESTAMP WITH TIME ZONE,
    last_sync_status VARCHAR(20),
    sync_error_count INTEGER DEFAULT 0,
    health_status VARCHAR(20) CHECK (health_status IN ('healthy', 'degraded', 'unhealthy', 'unknown')) DEFAULT 'unknown',
    
    -- Configuration
    configuration JSONB DEFAULT '{}'::jsonb,
    scopes VARCHAR(100)[], -- OAuth scopes or permission levels
    
    -- Audit
    connected_at TIMESTAMP WITH TIME ZONE,
    connected_by UUID REFERENCES users(id),
    disconnected_at TIMESTAMP WITH TIME ZONE,
    disconnected_by UUID REFERENCES users(id),
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_registry_tenant ON connector_registry(tenant_id);
CREATE INDEX IF NOT EXISTS idx_connector_registry_type ON connector_registry(connector_type);
CREATE INDEX IF NOT EXISTS idx_connector_registry_provider ON connector_registry(provider);
CREATE INDEX IF NOT EXISTS idx_connector_registry_status ON connector_registry(status);
CREATE INDEX IF NOT EXISTS idx_connector_registry_required ON connector_registry(is_required);
CREATE INDEX IF NOT EXISTS idx_connector_registry_expires ON connector_registry(token_expires_at);

-- AI Memory Documents - Structured embeddings for assistant context
CREATE TABLE IF NOT EXISTS ai_memory_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Document metadata
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('intent_summary', 'business_context', 'obligations', 'contacts', 'preferences', 'custom')),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    
    -- Embedding and vector search
    embedding_id VARCHAR(255), -- Reference to vector in Chroma/vector DB
    embedding_model VARCHAR(100),
    
    -- Categorization
    category VARCHAR(100),
    tags VARCHAR(100)[] DEFAULT '{}',
    priority INTEGER DEFAULT 0,
    
    -- Usage tracking
    last_accessed_at TIMESTAMP WITH TIME ZONE,
    access_count INTEGER DEFAULT 0,
    relevance_score DECIMAL(5,2),
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    version INTEGER DEFAULT 1,
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_memory_tenant ON ai_memory_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_memory_type ON ai_memory_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_ai_memory_category ON ai_memory_documents(category);
CREATE INDEX IF NOT EXISTS idx_ai_memory_active ON ai_memory_documents(is_active);
CREATE INDEX IF NOT EXISTS idx_ai_memory_embedding ON ai_memory_documents(embedding_id);

-- KYC Verification Records
CREATE TABLE IF NOT EXISTS kyc_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Verification details
    verification_type VARCHAR(50) NOT NULL CHECK (verification_type IN ('identity', 'business', 'address', 'document', 'comprehensive')),
    provider VARCHAR(100) NOT NULL, -- 'persona', 'onfido', 'jumio', 'internal'
    provider_verification_id VARCHAR(255),
    
    -- Status
    status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'in_progress', 'approved', 'rejected', 'expired', 'requires_review')) DEFAULT 'pending',
    verification_level VARCHAR(20) CHECK (verification_level IN ('basic', 'standard', 'enhanced', 'premium')),
    
    -- Documents and data
    document_type VARCHAR(50), -- 'passport', 'driving_license', 'national_id', 'business_registration', etc.
    document_references JSONB DEFAULT '[]'::jsonb, -- Array of document storage references
    extracted_data JSONB DEFAULT '{}'::jsonb, -- Extracted and verified data
    
    -- Provider response
    provider_response JSONB DEFAULT '{}'::jsonb,
    provider_score DECIMAL(5,2),
    provider_reason TEXT,
    
    -- Review and override
    requires_manual_review BOOLEAN DEFAULT false,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_notes TEXT,
    override_reason TEXT,
    
    -- Expiry
    verified_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_verifications_tenant ON kyc_verifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_user ON kyc_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_type ON kyc_verifications(verification_type);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_status ON kyc_verifications(status);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_provider ON kyc_verifications(provider);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_review ON kyc_verifications(requires_manual_review);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_expires ON kyc_verifications(expires_at);

-- Onboarding Sessions - State machine tracking
CREATE TABLE IF NOT EXISTS onboarding_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Session state
    current_state VARCHAR(100) NOT NULL,
    state_machine_config JSONB DEFAULT '{}'::jsonb,
    state_history JSONB DEFAULT '[]'::jsonb, -- Array of {state: string, timestamp: timestamp, event: string}
    
    -- Progress tracking
    completed_steps VARCHAR(50)[] DEFAULT '{}',
    current_step VARCHAR(50),
    progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
    
    -- Session metadata
    session_data JSONB DEFAULT '{}'::jsonb,
    error_state JSONB, -- Error details if session is in error state
    retry_count INTEGER DEFAULT 0,
    
    -- Timing
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Status
    status VARCHAR(20) NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'abandoned', 'error')) DEFAULT 'active',
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_tenant ON onboarding_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_user ON onboarding_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_state ON onboarding_sessions(current_state);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_status ON onboarding_sessions(status);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_active ON onboarding_sessions(status, last_activity_at);

-- Filing Calendar - Generated from intent profile
CREATE TABLE IF NOT EXISTS filing_calendars (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Filing details
    filing_type VARCHAR(50) NOT NULL, -- 'vat', 'corporation_tax', 'self_assessment', 'sales_tax', 'payroll'
    jurisdiction VARCHAR(2) NOT NULL,
    authority VARCHAR(100), -- 'HMRC', 'IRS', 'CRA', etc.
    
    -- Schedule
    frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'annually', 'custom')),
    due_day INTEGER, -- Day of month when filing is due
    due_month INTEGER, -- Month when filing is due (for annual)
    custom_schedule JSONB, -- Custom schedule definition
    
    -- Next filing
    next_filing_date DATE,
    next_due_date DATE,
    last_filed_date DATE,
    last_filed_period_start DATE,
    last_filed_period_end DATE,
    
    -- Reminders
    reminder_enabled BOOLEAN DEFAULT true,
    reminder_days_before INTEGER DEFAULT 5,
    last_reminder_sent_at TIMESTAMP WITH TIME ZONE,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    auto_file_enabled BOOLEAN DEFAULT false,
    
    -- Audit
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_filing_calendars_tenant ON filing_calendars(tenant_id);
CREATE INDEX IF NOT EXISTS idx_filing_calendars_type ON filing_calendars(filing_type);
CREATE INDEX IF NOT EXISTS idx_filing_calendars_jurisdiction ON filing_calendars(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_filing_calendars_next_due ON filing_calendars(next_due_date);
CREATE INDEX IF NOT EXISTS idx_filing_calendars_active ON filing_calendars(is_active);

-- Onboarding Funnel Metrics
CREATE TABLE IF NOT EXISTS onboarding_funnel_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    session_id UUID REFERENCES onboarding_sessions(id) ON DELETE SET NULL,
    
    -- Metric details
    metric_type VARCHAR(50) NOT NULL, -- 'step_view', 'step_complete', 'step_abandon', 'connector_start', 'connector_complete', 'kyc_start', 'kyc_complete'
    step_name VARCHAR(50),
    connector_type VARCHAR(50),
    
    -- Timing
    time_spent_seconds INTEGER,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Context
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funnel_metrics_tenant ON onboarding_funnel_metrics(tenant_id);
CREATE INDEX IF NOT EXISTS idx_funnel_metrics_session ON onboarding_funnel_metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_funnel_metrics_type ON onboarding_funnel_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_funnel_metrics_step ON onboarding_funnel_metrics(step_name);
CREATE INDEX IF NOT EXISTS idx_funnel_metrics_timestamp ON onboarding_funnel_metrics(timestamp);

-- Onboarding Feedback
CREATE TABLE IF NOT EXISTS onboarding_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    session_id UUID REFERENCES onboarding_sessions(id) ON DELETE SET NULL,
    
    -- Feedback details
    overall_rating INTEGER CHECK (overall_rating >= 1 AND overall_rating <= 5),
    ease_of_use_rating INTEGER CHECK (ease_of_use_rating >= 1 AND ease_of_use_rating <= 5),
    clarity_rating INTEGER CHECK (clarity_rating >= 1 AND clarity_rating <= 5),
    helpfulness_rating INTEGER CHECK (helpfulness_rating >= 1 AND helpfulness_rating <= 5),
    
    -- Qualitative feedback
    positive_feedback TEXT,
    negative_feedback TEXT,
    suggestions TEXT,
    
    -- Specific step feedback
    step_feedback JSONB DEFAULT '{}'::jsonb, -- {step_name: {rating: number, comments: string}}
    
    -- Would recommend
    would_recommend BOOLEAN,
    nps_score INTEGER CHECK (nps_score >= 0 AND nps_score <= 10),
    
    -- Follow-up
    follow_up_consent BOOLEAN DEFAULT false,
    contact_preference VARCHAR(50),
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_feedback_tenant ON onboarding_feedback(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_feedback_user ON onboarding_feedback(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_feedback_session ON onboarding_feedback(session_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_feedback_rating ON onboarding_feedback(overall_rating);
CREATE INDEX IF NOT EXISTS idx_onboarding_feedback_timestamp ON onboarding_feedback(created_at);

-- Add updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_organization_invitations_updated_at BEFORE UPDATE ON organization_invitations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_intent_profiles_updated_at BEFORE UPDATE ON intent_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_consent_ledger_updated_at BEFORE UPDATE ON consent_ledger FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_connector_registry_updated_at BEFORE UPDATE ON connector_registry FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ai_memory_documents_updated_at BEFORE UPDATE ON ai_memory_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_kyc_verifications_updated_at BEFORE UPDATE ON kyc_verifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_onboarding_sessions_updated_at BEFORE UPDATE ON onboarding_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_filing_calendars_updated_at BEFORE UPDATE ON filing_calendars FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_onboarding_feedback_updated_at BEFORE UPDATE ON onboarding_feedback FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
