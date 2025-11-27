import { db } from './index';
import { QueryResult } from 'pg';

export interface FilingVersionInput {
  filingId: string;
  tenantId: string;
  snapshot: Record<string, unknown>;
  changedBy?: string | null;
  source?: string;
}

export interface FilingVersionRecord {
  id: string;
  filingId: string;
  tenantId: string;
  versionNumber: number;
  snapshot: Record<string, unknown>;
  createdAt: Date;
}

export async function recordFilingVersion(
  input: FilingVersionInput
): Promise<{ versionNumber: number; versionId: string }> {
  const latest: QueryResult<{ version_number: number | null }> = await db.query(
    `SELECT MAX(version_number) as version_number
       FROM filing_versions
      WHERE filing_id = $1 AND tenant_id = $2`,
    [input.filingId, input.tenantId]
  );

  const nextVersion = Number(latest.rows[0]?.version_number || 0) + 1;

  const result = await db.query<{ id: string; version_number: number }>(
    `INSERT INTO filing_versions (
        filing_id,
        tenant_id,
        version_number,
        snapshot,
        changed_by,
        source
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6)
      ON CONFLICT (filing_id, version_number)
      DO UPDATE SET snapshot = EXCLUDED.snapshot, changed_by = EXCLUDED.changed_by, source = EXCLUDED.source
      RETURNING id, version_number`,
    [
      input.filingId,
      input.tenantId,
      nextVersion,
      JSON.stringify(input.snapshot || {}),
      input.changedBy || null,
      input.source || null,
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to persist filing version');
  }

  return { versionNumber: row.version_number, versionId: row.id };
}

export async function recordFilingDiff(options: {
  filingId: string;
  tenantId: string;
  fromVersion: number;
  toVersion: number;
  diff: Record<string, unknown>;
}): Promise<void> {
  await db.query(
    `INSERT INTO filing_version_diffs (
        filing_id,
        tenant_id,
        from_version,
        to_version,
        diff
      ) VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (filing_id, from_version, to_version)
      DO UPDATE SET diff = EXCLUDED.diff, updated_at = NOW()`,
    [
      options.filingId,
      options.tenantId,
      options.fromVersion,
      options.toVersion,
      JSON.stringify(options.diff || {}),
    ]
  );
}

export async function getLatestFilingVersion(
  filingId: string,
  tenantId: string
): Promise<FilingVersionRecord | null> {
  const result = await db.query<{
    id: string;
    version_number: number;
    snapshot: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, version_number, snapshot, created_at
       FROM filing_versions
      WHERE filing_id = $1 AND tenant_id = $2
      ORDER BY version_number DESC
      LIMIT 1`,
    [filingId, tenantId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    filingId,
    tenantId,
    versionNumber: row.version_number,
    snapshot: row.snapshot,
    createdAt: row.created_at,
  };
}
