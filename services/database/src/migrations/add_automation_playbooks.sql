-- Migration: Automation playbooks and run history

-- Align automation_rules schema with service expectations
ALTER TABLE automation_rules
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Core playbook catalog per tenant
CREATE TABLE IF NOT EXISTS automation_playbooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    template_key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active', -- draft | active | paused
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    cadence_minutes INTEGER NOT NULL DEFAULT 1440,
    confirmation_required BOOLEAN NOT NULL DEFAULT false,
    last_run_at TIMESTAMPTZ,
    last_run_status TEXT,
    last_run_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_playbooks_tenant
  ON automation_playbooks(tenant_id);

CREATE INDEX IF NOT EXISTS idx_automation_playbooks_status
  ON automation_playbooks(status);

-- Run history + pending approvals
CREATE TABLE IF NOT EXISTS automation_playbook_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playbook_id UUID NOT NULL REFERENCES automation_playbooks(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    triggered_by TEXT NOT NULL,
    status TEXT NOT NULL, -- success | failed | skipped | awaiting_approval
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    action_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_playbook_runs_playbook
  ON automation_playbook_runs(playbook_id);

CREATE INDEX IF NOT EXISTS idx_playbook_runs_tenant
  ON automation_playbook_runs(tenant_id);
