import crypto from 'crypto';
import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { TenantId, UserId } from '@ai-accountant/shared-types';

export type PolicyType = 'terms_of_service' | 'privacy_policy';

export interface PolicyVersion {
  id: string;
  tenantId: TenantId | null;
  policyType: PolicyType;
  version: string;
  title: string;
  content: string;
  effectiveAt: Date;
}

export interface PolicyAcceptance {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  policyType: PolicyType;
  policyVersionId: string;
  version: string;
  signature: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  acceptedAt: Date;
}

export interface PolicyStatus {
  policy: PolicyVersion;
  acceptance?: PolicyAcceptance;
  accepted: boolean;
}

const logger = createLogger('compliance-legal');

const DEFAULT_POLICIES: Record<PolicyType, { version: string; title: string; content: string }> = {
  terms_of_service: {
    version: '2024-01',
    title: 'Terms of Service',
    content:
      'By using the AI Accountant platform you agree to our acceptable use, billing, and data handling commitments. These terms include audit logging, security controls, and responsible use of automated recommendations.',
  },
  privacy_policy: {
    version: '2024-01',
    title: 'Privacy Policy',
    content:
      'We collect only the data needed to deliver accounting automation. Data is encrypted in transit and at rest, and you may request export or erasure at any time. Usage analytics are aggregated whenever possible.',
  },
};

async function ensureDefaultPolicy(policyType: PolicyType): Promise<void> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM policy_versions WHERE policy_type = $1 AND tenant_id IS NULL LIMIT 1`,
    [policyType]
  );

  if (existing.rowCount && existing.rowCount > 0) {
    return;
  }

  const defaults = DEFAULT_POLICIES[policyType];
  await db.query(
    `INSERT INTO policy_versions (policy_type, tenant_id, version, title, content, effective_at)
     VALUES ($1, NULL, $2, $3, $4, NOW())`,
    [policyType, defaults.version, defaults.title, defaults.content]
  );
  logger.info('Created default policy version', { policyType, version: defaults.version });
}

async function getLatestPolicyVersion(policyType: PolicyType, tenantId: TenantId): Promise<PolicyVersion> {
  await ensureDefaultPolicy(policyType);

  const result = await db.query<{
    id: string;
    tenant_id: string | null;
    policy_type: PolicyType;
    version: string;
    title: string;
    content: string;
    effective_at: Date;
  }>(
    `SELECT id, tenant_id, policy_type, version, title, content, effective_at
     FROM policy_versions
     WHERE policy_type = $1 AND (tenant_id IS NULL OR tenant_id = $2)
     ORDER BY (tenant_id = $2)::int DESC, effective_at DESC
     LIMIT 1`,
    [policyType, tenantId]
  );

  if (!result.rows[0]) {
    throw new Error(`No policy version available for ${policyType}`);
  }

  const row = result.rows[0];
  return {
    id: row.id,
    tenantId: (row.tenant_id as TenantId | null) ?? null,
    policyType: row.policy_type,
    version: row.version,
    title: row.title,
    content: row.content,
    effectiveAt: new Date(row.effective_at),
  };
}

export async function getPolicyStatus(
  tenantId: TenantId,
  userId: UserId,
  policyType: PolicyType
): Promise<PolicyStatus> {
  const policy = await getLatestPolicyVersion(policyType, tenantId);

  const acceptanceResult = await db.query<{
    id: string;
    tenant_id: string;
    user_id: string;
    policy_type: PolicyType;
    policy_version_id: string;
    version: string;
    signature: string;
    user_agent: string | null;
    ip_address: string | null;
    accepted_at: Date;
  }>(
    `SELECT id, tenant_id, user_id, policy_type, policy_version_id, version, signature, user_agent, ip_address, accepted_at
     FROM policy_acceptances
     WHERE tenant_id = $1 AND user_id = $2 AND policy_type = $3
     ORDER BY accepted_at DESC
     LIMIT 1`,
    [tenantId, userId, policyType]
  );

  const acceptanceRow = acceptanceResult.rows[0];
  const acceptance = acceptanceRow
    ? {
        id: acceptanceRow.id,
        tenantId: acceptanceRow.tenant_id as TenantId,
        userId: acceptanceRow.user_id as UserId,
        policyType: acceptanceRow.policy_type,
        policyVersionId: acceptanceRow.policy_version_id,
        version: acceptanceRow.version,
        signature: acceptanceRow.signature,
        userAgent: acceptanceRow.user_agent,
        ipAddress: acceptanceRow.ip_address,
        acceptedAt: new Date(acceptanceRow.accepted_at),
      }
    : undefined;

  const status: PolicyStatus = {
    policy,
    accepted: Boolean(acceptance && acceptance.version === policy.version),
  };

  if (acceptance) {
    status.acceptance = acceptance;
  }

  return status;
}

export async function getPolicyStatuses(
  tenantId: TenantId,
  userId: UserId,
  policyTypes: PolicyType[] = ['terms_of_service', 'privacy_policy']
): Promise<PolicyStatus[]> {
  const statuses: PolicyStatus[] = [];
  for (const type of policyTypes) {
    statuses.push(await getPolicyStatus(tenantId, userId, type));
  }
  return statuses;
}

export async function recordPolicyAcceptance(
  tenantId: TenantId,
  userId: UserId,
  policyType: PolicyType,
  signature: string,
  metadata?: { userAgent?: string; ipAddress?: string }
): Promise<PolicyAcceptance> {
  const policy = await getLatestPolicyVersion(policyType, tenantId);
  const acceptanceId = crypto.randomUUID();

  const result = await db.query<{
    id: string;
    tenant_id: string;
    user_id: string;
    policy_type: PolicyType;
    policy_version_id: string;
    version: string;
    signature: string;
    user_agent: string | null;
    ip_address: string | null;
    accepted_at: Date;
  }>(
    `INSERT INTO policy_acceptances (
       id, tenant_id, user_id, policy_type, policy_version_id, version, signature, user_agent, ip_address
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id, user_id, policy_type, version)
     DO UPDATE SET signature = EXCLUDED.signature, accepted_at = NOW(), user_agent = EXCLUDED.user_agent, ip_address = EXCLUDED.ip_address
     RETURNING id, tenant_id, user_id, policy_type, policy_version_id, version, signature, user_agent, ip_address, accepted_at`,
    [
      acceptanceId,
      tenantId,
      userId,
      policyType,
      policy.id,
      policy.version,
      signature,
      metadata?.userAgent ?? null,
      metadata?.ipAddress ?? null,
    ]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Failed to record policy acceptance');
  }
  logger.info('Recorded policy acceptance', { tenantId, userId, policyType, version: policy.version });

  return {
    id: row.id,
    tenantId: row.tenant_id as TenantId,
    userId: row.user_id as UserId,
    policyType: row.policy_type,
    policyVersionId: row.policy_version_id,
    version: row.version,
    signature: row.signature,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    acceptedAt: new Date(row.accepted_at),
  };
}
