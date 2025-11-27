-- Migration: Add deterministic validation pipeline tables

CREATE TABLE IF NOT EXISTS validation_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    rule_id VARCHAR(100) NOT NULL,
    rule_name VARCHAR(255) NOT NULL,
    domain VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('pass', 'warning', 'fail')),
    message TEXT NOT NULL,
    data_path TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS validation_rejection_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    domain VARCHAR(50) NOT NULL,
    reason TEXT NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('warning', 'critical')),
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS validation_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    decision_id UUID NOT NULL REFERENCES validation_decisions(id) ON DELETE CASCADE,
    overridden_by UUID NOT NULL,
    reason TEXT NOT NULL,
    previous_status VARCHAR(20) NOT NULL CHECK (previous_status IN ('pass', 'warning', 'fail')),
    new_status VARCHAR(20) NOT NULL CHECK (new_status IN ('pass', 'warning', 'fail')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS validation_audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES validation_runs(id) ON DELETE CASCADE,
    actor UUID,
    action VARCHAR(100) NOT NULL,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_validation_decisions_run ON validation_decisions(run_id);
CREATE INDEX IF NOT EXISTS idx_validation_rejection_queue_run ON validation_rejection_queue(run_id);
CREATE INDEX IF NOT EXISTS idx_validation_overrides_decision ON validation_overrides(decision_id);
CREATE INDEX IF NOT EXISTS idx_validation_audit_events_run ON validation_audit_events(run_id);
