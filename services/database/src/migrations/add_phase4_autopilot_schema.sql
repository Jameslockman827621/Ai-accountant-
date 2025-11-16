-- Phase 4 Daily Autopilot Schema

-- Playbook Library
CREATE TABLE IF NOT EXISTS playbook_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100) NOT NULL, -- daily_reconciliation, weekly_review, monthly_close, filing_prep
  version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
  playbook_yaml TEXT NOT NULL,
  compiled_json JSONB,
  policy_requirements JSONB, -- Required permissions, risk thresholds
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by UUID,
  UNIQUE(name, version)
);

CREATE INDEX idx_playbook_library_category ON playbook_library(category, is_active);

-- Autopilot Tasks
CREATE TABLE IF NOT EXISTS autopilot_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_type VARCHAR(100) NOT NULL, -- reconciliation, posting, review, filing, journal_entry
  title VARCHAR(255) NOT NULL,
  description TEXT,
  priority VARCHAR(20) NOT NULL DEFAULT 'medium', -- low, medium, high, urgent
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, in_progress, completed, failed, cancelled
  severity VARCHAR(20) NOT NULL DEFAULT 'normal', -- normal, warning, critical
  
  -- Workflow
  playbook_id UUID REFERENCES playbook_library(id),
  workflow_stage VARCHAR(100),
  prerequisite_tasks UUID[],
  
  -- Assignment
  assigned_to UUID,
  assigned_by UUID,
  assignment_method VARCHAR(50), -- auto, round_robin, skill_based, manual
  auto_assigned BOOLEAN DEFAULT false,
  
  -- SLA
  due_date TIMESTAMP,
  sla_hours INTEGER,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  escalated BOOLEAN DEFAULT false,
  escalation_reason TEXT,
  
  -- AI Context
  ai_summary TEXT,
  source_evidence JSONB,
  recommended_action TEXT,
  confidence_score NUMERIC,
  
  -- Execution
  executed_by UUID, -- AI agent ID or user ID
  execution_method VARCHAR(50), -- ai_autonomous, ai_supervised, human
  execution_result JSONB,
  error_message TEXT,
  
  -- Audit
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by UUID,
  audit_trail JSONB,
  
  metadata JSONB
);

CREATE INDEX idx_autopilot_tasks_tenant_status ON autopilot_tasks(tenant_id, status);
CREATE INDEX idx_autopilot_tasks_assigned ON autopilot_tasks(assigned_to, status);
CREATE INDEX idx_autopilot_tasks_due_date ON autopilot_tasks(due_date, status);
CREATE INDEX idx_autopilot_tasks_playbook ON autopilot_tasks(playbook_id);

-- Task Dependencies
CREATE TABLE IF NOT EXISTS task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES autopilot_tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID NOT NULL REFERENCES autopilot_tasks(id) ON DELETE CASCADE,
  dependency_type VARCHAR(50) NOT NULL, -- blocks, requires, suggests
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(task_id, depends_on_task_id)
);

-- Autopilot Agenda (Daily Task Graph)
CREATE TABLE IF NOT EXISTS autopilot_agenda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agenda_date DATE NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Summary
  total_tasks INTEGER NOT NULL DEFAULT 0,
  pending_tasks INTEGER NOT NULL DEFAULT 0,
  in_progress_tasks INTEGER NOT NULL DEFAULT 0,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  overdue_tasks INTEGER NOT NULL DEFAULT 0,
  
  -- Priorities
  urgent_count INTEGER NOT NULL DEFAULT 0,
  high_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  low_count INTEGER NOT NULL DEFAULT 0,
  
  -- SLA Status
  on_track_count INTEGER NOT NULL DEFAULT 0,
  at_risk_count INTEGER NOT NULL DEFAULT 0,
  breached_count INTEGER NOT NULL DEFAULT 0,
  
  -- Task IDs
  task_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  
  metadata JSONB,
  UNIQUE(tenant_id, agenda_date)
);

CREATE INDEX idx_autopilot_agenda_tenant_date ON autopilot_agenda(tenant_id, agenda_date DESC);

-- Autopilot Policies
CREATE TABLE IF NOT EXISTS autopilot_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  policy_name VARCHAR(255) NOT NULL,
  policy_type VARCHAR(100) NOT NULL, -- action_permission, risk_threshold, approval_required
  scope VARCHAR(100) NOT NULL, -- tenant, role, user, playbook
  scope_id UUID,
  
  -- Policy Rules
  conditions JSONB NOT NULL,
  actions JSONB NOT NULL, -- auto, require_review, block
  risk_threshold NUMERIC,
  
  -- Priority
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by UUID,
  
  UNIQUE(tenant_id, policy_name) WHERE tenant_id IS NOT NULL
);

CREATE INDEX idx_autopilot_policies_tenant ON autopilot_policies(tenant_id, is_active);
CREATE INDEX idx_autopilot_policies_scope ON autopilot_policies(scope, scope_id, is_active);

-- Task Execution History (Audit Trail)
CREATE TABLE IF NOT EXISTS task_execution_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES autopilot_tasks(id) ON DELETE CASCADE,
  
  -- Action Details
  action_type VARCHAR(100) NOT NULL, -- created, assigned, started, completed, failed, cancelled
  action_by UUID, -- User ID or AI agent ID
  action_method VARCHAR(50), -- ai_autonomous, ai_supervised, human
  action_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Context
  previous_status VARCHAR(50),
  new_status VARCHAR(50),
  changes JSONB,
  reasoning TEXT, -- AI reasoning for action
  evidence JSONB, -- Supporting data
  
  -- Playbook Context
  playbook_id UUID REFERENCES playbook_library(id),
  playbook_version VARCHAR(50),
  model_version VARCHAR(50),
  
  -- Approval
  approval_required BOOLEAN DEFAULT false,
  approved_by UUID,
  approved_at TIMESTAMP,
  
  -- Rollback
  can_rollback BOOLEAN DEFAULT false,
  rollback_data JSONB,
  
  immutable_hash VARCHAR(64), -- For tamper detection
  
  metadata JSONB
);

CREATE INDEX idx_task_execution_history_task ON task_execution_history(task_id, action_timestamp);
CREATE INDEX idx_task_execution_history_agent ON task_execution_history(action_by, action_method);

-- SLA Tracking
CREATE TABLE IF NOT EXISTS sla_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id UUID REFERENCES autopilot_tasks(id) ON DELETE CASCADE,
  playbook_id UUID REFERENCES playbook_library(id),
  
  -- SLA Definition
  sla_type VARCHAR(100) NOT NULL, -- response_time, resolution_time, completion_time
  sla_hours INTEGER NOT NULL,
  sla_start_time TIMESTAMP NOT NULL,
  sla_due_time TIMESTAMP NOT NULL,
  
  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'on_track', -- on_track, at_risk, breached
  completed_at TIMESTAMP,
  actual_hours NUMERIC,
  
  -- Metrics
  time_to_start NUMERIC, -- Hours from creation to start
  time_to_complete NUMERIC, -- Hours from start to complete
  escalation_count INTEGER DEFAULT 0,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sla_tracking_tenant_status ON sla_tracking(tenant_id, status);
CREATE INDEX idx_sla_tracking_due_time ON sla_tracking(sla_due_time, status);

-- Accountant Firm Management
CREATE TABLE IF NOT EXISTS accountant_firms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_name VARCHAR(255) NOT NULL,
  firm_type VARCHAR(50), -- sole_proprietor, partnership, corporation
  registration_number VARCHAR(100),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  
  -- Settings
  default_sla_hours INTEGER DEFAULT 24,
  notification_preferences JSONB,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by UUID
);

-- Accountant Staff Roles
CREATE TABLE IF NOT EXISTS accountant_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES accountant_firms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL, -- partner, senior_accountant, accountant, junior, reviewer
  permissions JSONB NOT NULL,
  
  -- Assignment Preferences
  max_concurrent_tasks INTEGER DEFAULT 10,
  skill_tags TEXT[],
  preferred_clients UUID[],
  
  -- Performance
  tasks_completed INTEGER DEFAULT 0,
  average_completion_time NUMERIC,
  sla_adherence_rate NUMERIC,
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  UNIQUE(firm_id, user_id)
);

CREATE INDEX idx_accountant_staff_firm ON accountant_staff(firm_id, is_active);
CREATE INDEX idx_accountant_staff_user ON accountant_staff(user_id);

-- Firm Client Relationships
CREATE TABLE IF NOT EXISTS firm_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id UUID NOT NULL REFERENCES accountant_firms(id) ON DELETE CASCADE,
  client_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Relationship
  relationship_type VARCHAR(50) NOT NULL, -- primary, secondary, consulting
  engagement_start DATE,
  engagement_end DATE,
  is_active BOOLEAN DEFAULT true,
  
  -- Assignment
  primary_accountant_id UUID REFERENCES accountant_staff(id),
  secondary_accountant_ids UUID[],
  
  -- Settings
  sla_hours INTEGER,
  notification_preferences JSONB,
  pinned BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  UNIQUE(firm_id, client_tenant_id)
);

CREATE INDEX idx_firm_clients_firm ON firm_clients(firm_id, is_active);
CREATE INDEX idx_firm_clients_client ON firm_clients(client_tenant_id);

-- Assistant Command Log
CREATE TABLE IF NOT EXISTS assistant_command_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  
  -- Command
  command_type VARCHAR(100) NOT NULL, -- run_playbook, post_journal_entry, approve_task, create_task, escalate
  command_text TEXT NOT NULL,
  command_params JSONB,
  
  -- Execution
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, executing, completed, failed, rejected
  execution_result JSONB,
  error_message TEXT,
  
  -- Verification
  prerequisites_met BOOLEAN,
  verification_checks JSONB,
  risk_score NUMERIC,
  
  -- Simulation
  simulation_mode BOOLEAN DEFAULT false,
  simulation_result JSONB,
  
  -- Feedback
  user_feedback VARCHAR(20), -- thumbs_up, thumbs_down, neutral
  feedback_notes TEXT,
  
  -- Context
  reasoning_trace JSONB,
  model_version VARCHAR(50),
  playbook_version VARCHAR(50),
  
  executed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assistant_command_log_tenant ON assistant_command_log(tenant_id, created_at DESC);
CREATE INDEX idx_assistant_command_log_status ON assistant_command_log(status, created_at DESC);

-- Autopilot Metrics
CREATE TABLE IF NOT EXISTS autopilot_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  
  -- Task Metrics
  tasks_created INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  tasks_failed INTEGER DEFAULT 0,
  tasks_automated INTEGER DEFAULT 0,
  tasks_manual INTEGER DEFAULT 0,
  
  -- Automation Rate
  automation_rate NUMERIC, -- Percentage of tasks automated
  
  -- SLA Metrics
  sla_adherence_rate NUMERIC,
  sla_breaches INTEGER DEFAULT 0,
  average_completion_time NUMERIC,
  
  -- Assistant Metrics
  assistant_commands INTEGER DEFAULT 0,
  assistant_success_rate NUMERIC,
  assistant_rollback_rate NUMERIC,
  
  -- Playbook Metrics
  playbooks_executed INTEGER DEFAULT 0,
  playbook_success_rate NUMERIC,
  
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, metric_date)
);

CREATE INDEX idx_autopilot_metrics_tenant_date ON autopilot_metrics(tenant_id, metric_date DESC);

-- Updated at triggers
CREATE TRIGGER update_playbook_library_updated_at
  BEFORE UPDATE ON playbook_library
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_autopilot_tasks_updated_at
  BEFORE UPDATE ON autopilot_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_autopilot_policies_updated_at
  BEFORE UPDATE ON autopilot_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sla_tracking_updated_at
  BEFORE UPDATE ON sla_tracking
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accountant_firms_updated_at
  BEFORE UPDATE ON accountant_firms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_accountant_staff_updated_at
  BEFORE UPDATE ON accountant_staff
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_firm_clients_updated_at
  BEFORE UPDATE ON firm_clients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
