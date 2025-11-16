-- Migration: Add tables for globally adaptive onboarding flow (Chunk 1)
-- This migration adds jurisdictions, entity_types, and onboarding_step_data tables

-- Jurisdictions table - Supported jurisdictions with localization settings
CREATE TABLE IF NOT EXISTS jurisdictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(2) NOT NULL UNIQUE, -- ISO 3166-1 alpha-2 country code
    name VARCHAR(100) NOT NULL,
    currency_code VARCHAR(3) NOT NULL, -- ISO 4217 currency code
    currency_symbol VARCHAR(10) NOT NULL,
    date_format VARCHAR(20) NOT NULL DEFAULT 'DD/MM/YYYY', -- Format string
    timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
    tax_authorities JSONB DEFAULT '[]'::jsonb, -- Array of {name: string, authority_type: string}
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jurisdictions_code ON jurisdictions(code);
CREATE INDEX IF NOT EXISTS idx_jurisdictions_enabled ON jurisdictions(enabled);

-- Entity types table - Business entity types per jurisdiction
CREATE TABLE IF NOT EXISTS entity_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    jurisdiction_code VARCHAR(2) NOT NULL REFERENCES jurisdictions(code),
    code VARCHAR(50) NOT NULL, -- 'sole_trader', 'limited_company', etc.
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    tax_implications JSONB DEFAULT '{}'::jsonb, -- Tax-specific information
    required_fields JSONB DEFAULT '[]'::jsonb, -- Array of required field names
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(jurisdiction_code, code)
);

CREATE INDEX IF NOT EXISTS idx_entity_types_jurisdiction ON entity_types(jurisdiction_code);
CREATE INDEX IF NOT EXISTS idx_entity_types_code ON entity_types(code);
CREATE INDEX IF NOT EXISTS idx_entity_types_enabled ON entity_types(enabled);

-- Onboarding step data table - Stores per-step data with validation
CREATE TABLE IF NOT EXISTS onboarding_step_data (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    step_name VARCHAR(50) NOT NULL,
    step_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    validation_status VARCHAR(20) CHECK (validation_status IN ('pending', 'valid', 'invalid', 'warning')) DEFAULT 'pending',
    validation_errors JSONB DEFAULT '[]'::jsonb, -- Array of validation error objects
    is_draft BOOLEAN DEFAULT true, -- True if step is saved but not completed
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, step_name)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_step_data_tenant ON onboarding_step_data(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_step_data_step ON onboarding_step_data(step_name);
CREATE INDEX IF NOT EXISTS idx_onboarding_step_data_draft ON onboarding_step_data(is_draft);

-- KYC Audit Events table (Chunk 2)
CREATE TABLE IF NOT EXISTS kyc_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    verification_id UUID REFERENCES kyc_verifications(id) ON DELETE SET NULL,
    
    -- Event details
    event_type VARCHAR(50) NOT NULL, -- 'verification_started', 'verification_completed', 'review_requested', 'review_completed', 'status_changed', 'webhook_received'
    event_source VARCHAR(50) NOT NULL, -- 'user', 'system', 'provider_webhook', 'admin'
    
    -- Event data
    event_data JSONB DEFAULT '{}'::jsonb,
    previous_status VARCHAR(20),
    new_status VARCHAR(20),
    
    -- Provider information
    provider VARCHAR(100),
    provider_event_id VARCHAR(255),
    
    -- Review information
    reviewed_by UUID REFERENCES users(id),
    review_notes TEXT,
    review_decision VARCHAR(20), -- 'approved', 'rejected', 'pending'
    
    -- IP and user agent for audit trail
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_audit_events_tenant ON kyc_audit_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kyc_audit_events_user ON kyc_audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_audit_events_verification ON kyc_audit_events(verification_id);
CREATE INDEX IF NOT EXISTS idx_kyc_audit_events_type ON kyc_audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_kyc_audit_events_created ON kyc_audit_events(created_at);

-- Connector Catalog table (Chunk 3)
CREATE TABLE IF NOT EXISTS connector_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Provider identification
    provider VARCHAR(100) NOT NULL UNIQUE, -- 'plaid', 'truelayer', 'quickbooks', 'xero', etc.
    provider_name VARCHAR(255) NOT NULL, -- Human-readable name
    connector_type VARCHAR(50) NOT NULL, -- 'bank', 'accounting', 'payroll', 'commerce'
    
    -- Availability
    supported_jurisdictions VARCHAR(2)[] DEFAULT '{}', -- Array of jurisdiction codes
    supported_entity_types VARCHAR(50)[] DEFAULT '{}', -- Array of entity type codes
    
    -- Configuration
    auth_type VARCHAR(50) NOT NULL, -- 'oauth2', 'api_key', 'token', 'link_token'
    auth_config JSONB DEFAULT '{}'::jsonb, -- Provider-specific auth configuration
    required_scopes VARCHAR(100)[] DEFAULT '[]',
    optional_scopes VARCHAR(100)[] DEFAULT '[]',
    
    -- Capabilities
    capabilities JSONB DEFAULT '[]'::jsonb, -- Array of capability strings
    sync_frequency_options VARCHAR(20)[] DEFAULT '{}', -- ['realtime', 'hourly', 'daily', 'manual']
    default_sync_frequency VARCHAR(20) DEFAULT 'daily',
    
    -- Metadata
    description TEXT,
    documentation_url VARCHAR(500),
    logo_url VARCHAR(500),
    category VARCHAR(50), -- 'primary', 'secondary', 'optional'
    priority INTEGER DEFAULT 0, -- Higher priority shown first
    
    -- Status
    enabled BOOLEAN DEFAULT true,
    is_beta BOOLEAN DEFAULT false,
    maintenance_mode BOOLEAN DEFAULT false,
    
    -- Health monitoring
    health_check_url VARCHAR(500),
    health_check_interval_minutes INTEGER DEFAULT 60,
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_catalog_provider ON connector_catalog(provider);
CREATE INDEX IF NOT EXISTS idx_connector_catalog_type ON connector_catalog(connector_type);
CREATE INDEX IF NOT EXISTS idx_connector_catalog_enabled ON connector_catalog(enabled);
CREATE INDEX IF NOT EXISTS idx_connector_catalog_priority ON connector_catalog(priority DESC);

-- Add updated_at triggers
CREATE TRIGGER update_jurisdictions_updated_at BEFORE UPDATE ON jurisdictions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_entity_types_updated_at BEFORE UPDATE ON entity_types FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_onboarding_step_data_updated_at BEFORE UPDATE ON onboarding_step_data FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_connector_catalog_updated_at BEFORE UPDATE ON connector_catalog FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default jurisdictions
INSERT INTO jurisdictions (code, name, currency_code, currency_symbol, date_format, timezone) VALUES
    ('GB', 'United Kingdom', 'GBP', '£', 'DD/MM/YYYY', 'Europe/London'),
    ('US', 'United States', 'USD', '$', 'MM/DD/YYYY', 'America/New_York'),
    ('CA', 'Canada', 'CAD', 'C$', 'YYYY-MM-DD', 'America/Toronto'),
    ('AU', 'Australia', 'AUD', 'A$', 'DD/MM/YYYY', 'Australia/Sydney'),
    ('SG', 'Singapore', 'SGD', 'S$', 'DD/MM/YYYY', 'Asia/Singapore'),
    ('IE', 'Ireland', 'EUR', '€', 'DD/MM/YYYY', 'Europe/Dublin'),
    ('MX', 'Mexico', 'MXN', '$', 'DD/MM/YYYY', 'America/Mexico_City')
ON CONFLICT (code) DO NOTHING;

-- Insert default entity types for UK
INSERT INTO entity_types (jurisdiction_code, code, name, display_name, description) VALUES
    ('GB', 'sole_trader', 'Sole Trader', 'Sole Trader', 'Individual operating as a business'),
    ('GB', 'partnership', 'Partnership', 'Partnership', 'Two or more people in business together'),
    ('GB', 'limited_company', 'Limited Company', 'Limited Company', 'Private limited company (Ltd)'),
    ('GB', 'llp', 'LLP', 'Limited Liability Partnership', 'Limited liability partnership'),
    ('US', 'sole_proprietorship', 'Sole Proprietorship', 'Sole Proprietorship', 'Individual business owner'),
    ('US', 'llc', 'LLC', 'Limited Liability Company', 'Limited liability company'),
    ('US', 'corporation', 'Corporation', 'Corporation', 'C-Corp or S-Corp'),
    ('CA', 'sole_proprietorship', 'Sole Proprietorship', 'Sole Proprietorship', 'Individual business owner'),
    ('CA', 'corporation', 'Corporation', 'Corporation', 'Canadian corporation')
ON CONFLICT (jurisdiction_code, code) DO NOTHING;

-- Insert default connector catalog entries
INSERT INTO connector_catalog (provider, provider_name, connector_type, supported_jurisdictions, auth_type, category, priority) VALUES
    ('plaid', 'Plaid', 'bank', ARRAY['US', 'CA'], 'link_token', 'primary', 10),
    ('truelayer', 'TrueLayer', 'bank', ARRAY['GB', 'IE'], 'oauth2', 'primary', 10),
    ('yodlee', 'Yodlee', 'bank', ARRAY['GB', 'US', 'CA', 'AU', 'SG', 'IE'], 'oauth2', 'secondary', 8),
    ('codat', 'Codat', 'bank', ARRAY['GB', 'US', 'CA', 'AU', 'SG', 'IE', 'MX'], 'oauth2', 'secondary', 8),
    ('quickbooks', 'QuickBooks', 'accounting', ARRAY['US', 'CA', 'GB', 'AU'], 'oauth2', 'primary', 10),
    ('xero', 'Xero', 'accounting', ARRAY['GB', 'US', 'CA', 'AU', 'SG', 'IE'], 'oauth2', 'primary', 10),
    ('gusto', 'Gusto', 'payroll', ARRAY['US'], 'oauth2', 'primary', 10),
    ('shopify', 'Shopify', 'commerce', ARRAY['GB', 'US', 'CA', 'AU', 'SG', 'IE', 'MX'], 'oauth2', 'primary', 9),
    ('stripe', 'Stripe', 'commerce', ARRAY['GB', 'US', 'CA', 'AU', 'SG', 'IE', 'MX'], 'oauth2', 'primary', 9),
    ('paypal', 'PayPal', 'commerce', ARRAY['GB', 'US', 'CA', 'AU', 'SG', 'IE', 'MX'], 'oauth2', 'secondary', 7)
ON CONFLICT (provider) DO NOTHING;
