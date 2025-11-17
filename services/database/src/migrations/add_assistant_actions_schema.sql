-- Assistant Actions table for persisting tool calls with inputs/outputs/approvals
CREATE TABLE IF NOT EXISTS assistant_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    conversation_id UUID,
    
    -- Tool call details
    tool_name VARCHAR(100) NOT NULL,
    tool_args JSONB NOT NULL DEFAULT '{}'::jsonb,
    tool_result JSONB,
    tool_error TEXT,
    
    -- Execution status
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'rejected', 'rolled_back')),
    
    -- Approval workflow
    requires_approval BOOLEAN NOT NULL DEFAULT false,
    is_irreversible BOOLEAN NOT NULL DEFAULT false,
    approval_status VARCHAR(50) CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    
    -- Rollback support
    rollback_metadata JSONB,
    rolled_back_at TIMESTAMP WITH TIME ZONE,
    rolled_back_by UUID REFERENCES users(id),
    
    -- Sandbox vs Production
    execution_mode VARCHAR(20) NOT NULL DEFAULT 'production' CHECK (execution_mode IN ('sandbox', 'production')),
    
    -- Rate limiting
    rate_limit_key VARCHAR(255),
    
    -- Metadata
    model_version VARCHAR(50),
    reasoning_trace JSONB DEFAULT '[]'::jsonb,
    citations JSONB DEFAULT '[]'::jsonb,
    confidence_score DECIMAL(5, 4),
    
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_actions_tenant ON assistant_actions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_user ON assistant_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_conversation ON assistant_actions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_tool ON assistant_actions(tool_name);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_status ON assistant_actions(status);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_approval ON assistant_actions(approval_status) WHERE approval_status IS NOT NULL;

CREATE TRIGGER update_assistant_actions_updated_at BEFORE UPDATE ON assistant_actions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Filing Explanations table (if not exists)
CREATE TABLE IF NOT EXISTS filing_explanations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filing_id UUID NOT NULL REFERENCES filings(id) ON DELETE CASCADE,
    field_name VARCHAR(255) NOT NULL,
    value NUMERIC,
    calculation_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    rule_applied JSONB,
    source_entries UUID[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(filing_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_filing_explanations_filing ON filing_explanations(filing_id);

-- Assistant Evaluation Runs table
CREATE TABLE IF NOT EXISTS assistant_evaluation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    total_samples INTEGER NOT NULL,
    passed INTEGER NOT NULL,
    average_confidence DECIMAL(5, 4),
    average_coverage DECIMAL(5, 4),
    average_factuality DECIMAL(5, 4),
    average_groundedness DECIMAL(5, 4),
    results JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_evaluation_runs_tenant ON assistant_evaluation_runs(tenant_id, created_at DESC);

-- Assistant Conversation Samples table (for monitoring)
CREATE TABLE IF NOT EXISTS assistant_conversation_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    tool_calls JSONB DEFAULT '[]'::jsonb,
    confidence_score DECIMAL(5, 4),
    citations_count INTEGER DEFAULT 0,
    feedback VARCHAR(20) CHECK (feedback IN ('thumbs_up', 'thumbs_down', 'neutral')),
    feedback_notes TEXT,
    feedback_at TIMESTAMP WITH TIME ZONE,
    sampled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assistant_conversation_samples_tenant ON assistant_conversation_samples(tenant_id, sampled_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_conversation_samples_feedback ON assistant_conversation_samples(feedback) WHERE feedback IS NULL;

-- Assistant Feedback table
CREATE TABLE IF NOT EXISTS assistant_feedback (
    conversation_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feedback VARCHAR(20) NOT NULL CHECK (feedback IN ('thumbs_up', 'thumbs_down', 'neutral')),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_assistant_feedback_user ON assistant_feedback(user_id, created_at DESC);
