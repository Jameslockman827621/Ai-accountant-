-- Add entity_type column to tenants table for UK tax entity classification
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50) DEFAULT 'sole_trader';

-- Add index for entity type queries
CREATE INDEX IF NOT EXISTS idx_tenants_entity_type ON tenants(entity_type);

-- Add comment
COMMENT ON COLUMN tenants.entity_type IS 'UK entity type: sole_trader, freelancer, partnership, llp, ltd, plc, cic, charity, etc.';
