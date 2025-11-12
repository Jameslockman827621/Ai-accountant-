-- SOC 2 and ISO 27001 compliance tables
CREATE TABLE IF NOT EXISTS control_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  tenant_id UUID REFERENCES tenants(id),
  activity VARCHAR(255) NOT NULL,
  details JSONB,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS control_documentation (
  control_id VARCHAR(255) PRIMARY KEY,
  description TEXT NOT NULL,
  documented_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk_assessments (
  risk_id VARCHAR(255) PRIMARY KEY,
  description TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  assessed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitoring_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failure', 'warning')),
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource VARCHAR(255) NOT NULL,
  action VARCHAR(255) NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, resource, action)
);

CREATE INDEX IF NOT EXISTS idx_control_activities_user_id ON control_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_control_activities_tenant_id ON control_activities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_control_activities_timestamp ON control_activities(timestamp);
CREATE INDEX IF NOT EXISTS idx_monitoring_activities_timestamp ON monitoring_activities(timestamp);
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);
