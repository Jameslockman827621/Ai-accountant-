-- Metrics table for monitoring
CREATE TABLE IF NOT EXISTS metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  tags JSONB,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name);
CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_tags ON metrics USING GIN(tags);

-- Partition by month for better performance
CREATE TABLE IF NOT EXISTS metrics_archive (
  LIKE metrics INCLUDING ALL
) PARTITION BY RANGE (timestamp);
