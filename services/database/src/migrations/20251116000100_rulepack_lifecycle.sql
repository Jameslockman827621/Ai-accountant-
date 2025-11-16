BEGIN;

ALTER TABLE tax_rulepacks
    ADD COLUMN IF NOT EXISTS jurisdiction_code VARCHAR(20),
    ADD COLUMN IF NOT EXISTS region VARCHAR(20),
    ADD COLUMN IF NOT EXISTS year INTEGER,
    ADD COLUMN IF NOT EXISTS filing_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS checksum VARCHAR(64),
    ADD COLUMN IF NOT EXISTS regression_summary JSONB,
    ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ;

UPDATE tax_rulepacks
SET
    jurisdiction_code = COALESCE(jurisdiction_code, country),
    region = COALESCE(region, country),
    year = COALESCE(year, EXTRACT(YEAR FROM effective_from)::INT),
    status = CASE
        WHEN is_active IS TRUE THEN 'active'
        ELSE status
    END
WHERE jurisdiction_code IS NULL
   OR region IS NULL
   OR year IS NULL
   OR status IS NULL
   OR status = '';

ALTER TABLE tax_rulepacks
    ALTER COLUMN jurisdiction_code SET NOT NULL,
    ALTER COLUMN region SET NOT NULL,
    ALTER COLUMN year SET NOT NULL;

ALTER TABLE tax_rulepacks
    ADD CONSTRAINT IF NOT EXISTS tax_rulepacks_jurisdiction_year_version_key UNIQUE (jurisdiction_code, year, version);

CREATE INDEX IF NOT EXISTS idx_tax_rulepacks_jurisdiction_status ON tax_rulepacks(jurisdiction_code, status);

CREATE TABLE IF NOT EXISTS rulepack_regressions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rulepack_id UUID NOT NULL REFERENCES tax_rulepacks(id) ON DELETE CASCADE,
    case_id VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    input JSONB NOT NULL,
    expected JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pass', 'fail', 'skipped')),
    last_run_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(rulepack_id, case_id)
);

CREATE TRIGGER update_rulepack_regressions_updated_at
    BEFORE UPDATE ON rulepack_regressions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;
